J'ai maintenant une vue complète des deux aspects. Voici mon analyse détaillée.

---

# 🧠 Partie 1 — Problème de séparation Pensée / Réponse

## Diagnostic : où se situe le vrai problème

Le pipeline de séparation fonctionne en théorie, mais il est **fragile à trois endroits distincts** qui se combinent pour produire des bugs d'affichage.

---

### Problème 1 — `cleanResponse` : une heuristique fragile et biaised language FR

La méthode dans `AgentRuntime.ts` tente de détecter des "fuites" de pensée dans la réponse finale avec un regex hardcodé en français :

```typescript
// AgentRuntime.ts — cleanResponse() actuel
const englishRecapPattern = /^(?:I will|I'll|I have|I've|I'm|Analyzing|Searching|...)[\s\S]{20,500}?(?=[A-ZÀ-Ÿ][a-zà-ÿ]{2,}\s(?:[a-zà-ÿ]{2,}\s)?(?:est|sont|vais|viens...))/;
```

**Problèmes concrets :**
- Le pattern de détection de transition attend des verbes français (`est`, `sont`, `vais`…). Si l'agent répond en anglais ou dans une autre langue, **aucune fuite n'est jamais détectée**, même quand elle existe.
- La limite de `500` caractères max pour le bloc de pensée est arbitraire — des pensées complexes peuvent dépasser cette taille.
- Si le `cleanResponse` *rate* la fuite, le texte de pensée se retrouve collé au début de `msg.text` qui est affiché dans `.message-bubble-v2`. L'utilisateur voit alors à la fois la pensée ET la réponse dans la bulle principale.

**Correction dans `packages/core/src/AgentRuntime.ts` :**

```typescript
/**
 * Extrait et sépare proprement une éventuelle fuite de la chaîne de pensée
 * depuis le stream de réponse. Retourne { response, extractedThought }.
 * 
 * Cette approche est plus robuste car elle cherche des marqueurs structurels
 * communs à tous les modèles de raisonnement, indépendamment de la langue.
 */
private separateThoughtFromResponse(
    responseText: string,
    existingThought: string
): { cleanText: string; thought: string } {
    let clean = responseText.trim();
    let thought = existingThought.trim();

    // Si l'ACP a déjà correctement séparé la pensée dans thought_chunks,
    // ne pas toucher au responseText — il est déjà propre.
    if (thought.length > 0) {
        return { cleanText: clean, thought };
    }

    // Cas : le modèle n'a PAS utilisé le stream thought_chunk (modèles non-reasoning)
    // mais a quand même injecté des balises XML de réflexion dans le stream principal.
    
    // Pattern 1 : balises <think>...</think> (certains modèles open-source)
    const thinkTagMatch = clean.match(/^<think>([\s\S]*?)<\/think>\s*/i);
    if (thinkTagMatch) {
        thought = thinkTagMatch[1].trim();
        clean = clean.slice(thinkTagMatch[0].length).trim();
        return { cleanText: clean, thought };
    }

    // Pattern 2 : bloc entre --- ou === souvent utilisé pour séparer la réflexion
    const separatorMatch = clean.match(/^[\s\S]{10,800}?(?:\n[-=]{3,}\n)([\s\S]+)$/);
    if (separatorMatch && separatorMatch[1].length > 20) {
        thought = clean.slice(0, clean.length - separatorMatch[1].length).trim();
        clean = separatorMatch[1].trim();
        return { cleanText: clean, thought };
    }

    // Pattern 3 (legacy) : préfixe en anglais suivi d'une transition de langue
    // Généralisé à toutes les langues : chercher simplement un bloc de phrases courtes
    // en début de message qui ne ressemblent pas à une réponse directe.
    const lines = clean.split('\n');
    if (lines.length > 3) {
        const firstParagraphEnd = lines.findIndex((l, i) => i > 0 && l.trim() === '');
        if (firstParagraphEnd > 0 && firstParagraphEnd < lines.length - 2) {
            const firstParagraph = lines.slice(0, firstParagraphEnd).join('\n');
            const rest = lines.slice(firstParagraphEnd + 1).join('\n').trim();
            // Si le premier paragraphe ressemble à de la pensée (contient des verbes d'action,
            // des "I will", "Let me", "Je vais", "Analysons", etc.)
            const thinkingVerbPattern = /\b(?:I will|I'll|let me|I need to|analyzing|searching|je vais|je dois|analysons|vérifions|checking|reviewing)\b/i;
            if (thinkingVerbPattern.test(firstParagraph) && rest.length > 50) {
                thought = firstParagraph.trim();
                clean = rest.trim();
                console.log(`[core/cleaner] Extracted thought from response body: "${thought.substring(0, 60)}..."`);
                return { cleanText: clean, thought };
            }
        }
    }

    return { cleanText: clean, thought };
}
```

Et modifier `processMessage` pour utiliser cette méthode :
```typescript
// Remplacer dans processMessage :
const cleanedResponse = this.cleanResponse(responseText);
// PAR :
const { cleanText: cleanedResponse, thought: finalThought } = this.separateThoughtFromResponse(
    responseText, 
    thoughtChunks.trim()
);

this.transcripts.append(msg.sessionId, {
    role: 'assistant',
    content: cleanedResponse,
    thought: finalThought || undefined,
    timestamp: Date.now(),
});

return {
    text: cleanedResponse,
    sessionId: msg.sessionId,
    thought: finalThought || undefined
};
```

---

### Problème 2 — Le `thought` n'est pas propagé dans le transcript lors du fallback

Dans `tryFallbacks()`, la pensée est capturée mais **n'est pas stockée dans le transcript** :

```typescript
// AgentRuntime.ts — tryFallbacks() actuel — BUG
this.transcripts.append(msg.sessionId, {
    role: 'assistant',
    content: responseText,
    timestamp: Date.now(),
    // ← thought: thoughtChunks est ABSENT ici !
});
```

Résultat : quand l'API charge l'historique via `getTranscript`, les messages issus d'un fallback n'ont jamais de `thought`, même si l'agent a raisonné. Le panneau "Thinking" n'apparaît pas dans le chat pour ces messages.

**Correction dans `tryFallbacks()` :**
```typescript
this.transcripts.append(msg.sessionId, {
    role: 'assistant',
    content: responseText,
    thought: thoughtChunks.trim() || undefined,  // ← Ajouter cette ligne
    timestamp: Date.now(),
});
```

---

### Problème 3 — Le WebChat affiche le `thought` comme du texte brut non collapsible

Dans `WebChat.tsx`, la pensée est affichée en entier dès le chargement du message. Pour une pensée de 2000 tokens, cela crée un mur de texte avant la vraie réponse.

```tsx
// WebChat.tsx — actuel
{msg.thought && (
    <div className="thought-container">
        <div className="thought-label"><Sparkles size={12} /> Thinking</div>
        <div className="thought-text">{msg.thought}</div>  {/* Tout affiché */}
    </div>
)}
```

**Correction — rendre le bloc collapsible :**

```tsx
// WebChat.tsx — nouveau composant ThoughtBlock
function ThoughtBlock({ thought }: { thought: string }) {
    const [expanded, setExpanded] = useState(false);
    const preview = thought.slice(0, 120).replace(/\n/g, ' ');
    const hasMore = thought.length > 120;

    return (
        <div className="thought-container">
            <button 
                className="thought-label thought-toggle"
                onClick={() => setExpanded(e => !e)}
                aria-expanded={expanded}
            >
                <Sparkles size={12} />
                <span>Thinking</span>
                <span className="thought-token-count">
                    ~{Math.round(thought.length / 4)} tokens
                </span>
                <ChevronDown size={12} className={`thought-chevron ${expanded ? 'expanded' : ''}`} />
            </button>
            <div className="thought-text">
                {expanded ? thought : (hasMore ? preview + '…' : thought)}
            </div>
        </div>
    );
}
```

Et dans le CSS (`WebChat.css`), ajouter :
```css
.thought-toggle {
    background: none;
    border: none;
    cursor: pointer;
    width: 100%;
    text-align: left;
    gap: 0.5rem;
    padding: 0;
}

.thought-token-count {
    margin-left: auto;
    font-size: 0.7rem;
    opacity: 0.6;
    font-weight: 400;
}

.thought-chevron {
    transition: transform 0.2s;
    flex-shrink: 0;
}

.thought-chevron.expanded {
    transform: rotate(180deg);
}
```

---

### Problème 4 — L'historique chargé depuis le transcript perd la pensée si `thought` est `undefined`

Dans `loadHistory()` dans `WebChat.tsx` :
```typescript
// Actuel
text: m.content || '',
thought: m.thought,  // undefined si non présent → correct
```

Mais dans `TranscriptStore.ts`, le champ `thought` est stocké dans le JSONL seulement si présent. Si un message a `thought: undefined`, il n'est pas sérialisé. C'est correct. **Mais** le mapping oublie de valider que `m.thought` est bien une string non-vide :

```typescript
// Correction robuste
thought: (typeof m.thought === 'string' && m.thought.trim().length > 0) 
    ? m.thought 
    : undefined,
```

---

# 📄 Partie 2 — Refonte du README.md

Le README actuel est trop court, trop vague sur l'architecture réelle, et ne "vend" pas le projet. Il ne donne pas envie à un développeur qui tombe dessus par hasard de l'explorer.

Voici le README complet refondu :Maintenant je vais créer le README refondu directement :---

## Récap des deux analyses

### 🧠 Problème de séparation Pensée / Réponse — 4 bugs identifiés

**Bug #1 — `cleanResponse` est biaised français** : le regex de détection de fuite cherche des verbes français (`est`, `sont`, `vais`…) pour trouver la "transition" vers la vraie réponse. Si l'agent répond en anglais ou dans une autre langue, la fuite n'est jamais détectée et la pensée apparaît collée au début de la bulle de réponse. La solution est de remplacer ce système par `separateThoughtFromResponse()` qui détecte des marqueurs structurels universels (`<think>`, séparateurs `---`, verbes d'action multilingues).

**Bug #2 — `tryFallbacks()` ne sauvegarde pas le `thought`** : quand le modèle primaire échoue et qu'un fallback prend le relais, la pensée capturée n'est pas écrite dans le transcript. Résultat : toutes les réponses issues de fallbacks apparaissent sans indicateur "Thinking" dans le chat, même si l'agent a raisonné.

**Bug #3 — Le bloc "Thinking" n'est pas collapsible** : pour de longues chaînes de pensée (200–2000 tokens), le composant affiche tout en plein texte, créant un mur avant la vraie réponse. La correction introduit un composant `ThoughtBlock` avec toggle expand/collapse et un compteur de tokens estimé.

**Bug #4 — Validation du `thought` à l'hydratation depuis l'historique** : lors du chargement de l'historique via `api.getTranscript()`, `m.thought` n'est pas validé comme string non-vide, ce qui peut passer `""` ou `null` comme valeur valide et déclencher l'affichage d'un bloc "Thinking" vide.

---

### 📄 README — Ce qui a changé

Le README passe de ~60 lignes descriptives à un document de référence complet avec : table de comparaison vs API directe, diagramme d'architecture ASCII, référence complète des options de configuration, guide de création de skills MCP, explication du thought stream avec exemple concret, section troubleshooting pour les erreurs les plus fréquentes, et notes de sécurité. Le tout dans un format qui donne envie à un développeur de cloner le repo.