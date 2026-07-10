# Styles vidéo : schéma JSON et ajout d’un nouveau style

Cette documentation décrit la source de vérité des styles vidéo de Quran Caption et les étapes à
suivre pour ajouter ou modifier un style sans casser l’éditeur, les anciens projets ou l’export.

## Fichiers concernés

- `static/styles/styles.json` contient les styles des sous-titres arabes et des traductions.
- `static/styles/globalStyles.json` contient les styles globaux de la vidéo et les éléments affichés
  à l’écran : overlay, nom de sourate, récitateur, conteneur d’ayah et numéro de verset.
- `static/styles/customText.json`, `customImage.json` et `compositeStyles.json` décrivent les styles
  des éléments personnalisés et composites. Ils n’utilisent pas encore la navigation par panneaux
  documentée ci-dessous.

`styles.json` et `globalStyles.json` sont la source de vérité pour :

- la définition et la valeur par défaut des styles ;
- leur catégorie technique ;
- les panneaux de l’éditeur et leur ordre ;
- les groupes visuels au sein d’une catégorie ;
- les styles affichés comme switchs dans les en-têtes ;
- le déplacement purement visuel d’un style vers une autre catégorie.

Ne recréez pas ces mappings dans un composant Svelte. L’éditeur doit dériver sa structure des
métadonnées `ui` des JSON.

## Structure d’une catégorie

```json
{
	"id": "shadow",
	"name": "Shadow Effects",
	"description": "Add shadow effects to text and containers",
	"icon": "filter_drama",
	"ui": {
		"panel": {
			"id": "appearance",
			"icon": "format_color_fill",
			"label": "background",
			"order": 2,
			"categoryOrder": 2
		},
		"headerStyle": "shadow-enable"
	},
	"styles": []
}
```

### `ui.panel`

| Champ           | Rôle                                                                                      |
| --------------- | ----------------------------------------------------------------------------------------- |
| `id`            | Identifiant stable du panneau. Les catégories partageant cet identifiant sont regroupées. |
| `icon`          | Nom d’une Material Icon affichée dans l’onglet du panneau.                                |
| `label`         | Clé de libellé. Elle est résolue dans `style`, puis dans `editor.styleName`.              |
| `order`         | Position du panneau dans la barre horizontale.                                            |
| `categoryOrder` | Position de la catégorie à l’intérieur de ce panneau.                                     |

Toutes les catégories d’un même panneau doivent déclarer les mêmes `id`, `icon`, `label` et `order`.
Leur `categoryOrder` doit être unique.

Une catégorie sans `ui.panel` n’apparaît pas dans la navigation standard de l’éditeur.

### `ui.groups`

Les groupes organisent les longues listes de contrôles sans créer de cartes supplémentaires :

```json
"groups": [
  {
    "id": "typography",
    "styleIds": ["font-family", "font-size", "font-weight"]
  },
  {
    "id": "colors",
    "styleIds": ["text-color", "verse-number-color", "opacity"]
  }
]
```

Les identifiants de groupes actuellement supportés sont :

- `basics`
- `typography`
- `colors`
- `spacing`
- `layout`
- `timing`
- `effects`
- `advanced`
- `verseNumber`
- `decorations`
- `transitions`

Chaque identifiant correspond à une traduction `style.groupXxx` dans les six langues supportées. Un
nouvel identifiant de groupe exige donc l’ajout de sa traduction dans `en`, `fr`, `es`, `de`, `id`
et `zh`.

Dans une catégorie possédant des groupes, tout style local absent de `styleIds` est placé dans le
groupe de repli « Advanced ». Ce comportement évite de perdre un nouveau style, mais il ne doit pas
remplacer une décision explicite sur son emplacement.

### Déplacement visuel entre catégories

Un groupe peut référencer un style appartenant techniquement à une autre catégorie du même JSON.
C’est le cas de `opacity` : le style reste techniquement dans `effects`, mais il est référencé dans
le groupe `colors` de la catégorie `text`.

```json
{
	"id": "colors",
	"styleIds": ["text-color", "verse-number-color", "opacity"]
}
```

Cela modifie uniquement son emplacement dans l’éditeur. Sa catégorie technique, sa valeur et son
rendu restent inchangés.

Par défaut, référencer un style dans une autre catégorie le retire de sa catégorie technique. Un
groupe peut déclarer `"shared": true` pour conserver volontairement le contrôle dans sa catégorie
d'origine et l'afficher également dans la catégorie visuelle. Les deux contrôles modifient alors la
même instance de style. Réservez ce partage aux prérequis utiles dans plusieurs contextes et évitez
les duplications accidentelles.

### `ui.headerStyle`

`headerStyle` place le switch principal à droite du titre de la catégorie et le retire de la liste :

```json
"ui": {
  "panel": {},
  "headerStyle": "outline-enable"
}
```

Le style référencé doit :

- exister dans la catégorie technique concernée ;
- avoir `valueType: "boolean"` ;
- réellement piloter l’utilité ou la visibilité des autres contrôles de la catégorie.

`headerStyle` est une information d’interface. Il ne crée pas à lui seul une dépendance de rendu. La
génération CSS reconnaît notamment certains toggles grâce à leur identifiant contenant `enable`.
Vérifiez toujours le comportement dans `VideoStyle.generateCSS()` et dans les règles de dépendances
de l’éditeur.

## Structure d’un style

Exemple numérique :

```json
{
	"id": "text-shadow",
	"name": "Text Shadow",
	"description": "Control the intensity of text shadow",
	"value": 2,
	"valueType": "number",
	"valueMin": 0,
	"valueMax": 20,
	"step": 1,
	"css": "text-shadow: 0 0 {value}px var(--text-shadow-color);",
	"tailwind": false,
	"icon": "blur_on"
}
```

Champs principaux :

| Champ                          | Rôle                                                                            |
| ------------------------------ | ------------------------------------------------------------------------------- |
| `id`                           | Identifiant stable utilisé par les projets, le rendu, l’i18n et l’éditeur.      |
| `name` / `description`         | Valeurs anglaises de secours ; l’interface utilise les traductions.             |
| `value`                        | Valeur par défaut pour les nouveaux projets.                                    |
| `valueType`                    | Type de contrôle : `color`, `number`, `select`, `boolean`, `text`, `time`, etc. |
| `valueMin`, `valueMax`, `step` | Contraintes d’un contrôle numérique.                                            |
| `options`                      | Valeurs autorisées pour un `select`.                                            |
| `css`                          | Déclaration produite ; `{value}` est remplacé par la valeur effective.          |
| `tailwind` / `tailwindClass`   | Configuration Tailwind historique lorsque le style l’utilise.                   |
| `icon`                         | Material Icon du contrôle.                                                      |

## Ajout d’un nouveau style

### 1. Choisir la source et la catégorie technique

Ajoutez le style dans `styles.json` s’il appartient aux sous-titres, ou dans `globalStyles.json`
s’il appartient à la vidéo ou aux éléments globaux.

La catégorie technique détermine notamment le rendu CSS et le stockage. Ne déplacez pas un style
existant vers une autre catégorie uniquement pour modifier sa position visuelle : utilisez plutôt
`ui.groups`.

### 2. Choisir un identifiant stable

L’identifiant ne doit pas entrer en collision avec un autre style de la même cible. Un renommage
ultérieur exige une migration explicite, car les projets enregistrent les valeurs par identifiant.

Ajoutez également l’identifiant à l’union appropriée dans `src/lib/classes/VideoStyle.svelte.ts`,
puis à l’union globale `StyleName` si une nouvelle union est créée.

### 3. Définir le contrôle et le rendu

- Choisissez le bon `valueType`.
- Réutilisez le composant correspondant dans `styleEditor/controls`. Un nouveau `valueType` exige un
  composant dédié et son branchement minimal dans `Style.svelte`.
- Ajoutez les limites et le `step` pour un nombre.
- Ajoutez toutes les `options` pour un select.
- Vérifiez l’unité attendue par le rendu : pixels, millisecondes, ratio de `0` à `1`, etc.
- Définissez `css` ou le traitement TypeScript spécifique nécessaire.
- N’ajoutez pas un CSS générique si le style est consommé directement par le renderer ou
  l’exporteur.

### 4. Placer le contrôle dans l’éditeur

- Ajoutez son identifiant au `styleIds` du groupe approprié.
- Pour déplacer visuellement un style, référencez-le dans le groupe de la catégorie cible.
- Pour l'afficher aussi dans sa catégorie d'origine, ajoutez `"shared": true` au groupe cible.
- Pour un toggle pilotant toute la catégorie, utilisez `ui.headerStyle`.
- Si vous ajoutez une nouvelle catégorie, renseignez tous les champs de `ui.panel`.
- Si vous ajoutez un panneau, choisissez des `order` cohérents et une clé `label` traduisible.

### 5. Ajouter les traductions

Ajoutez le nom et la description dans `editor.styleName` et `editor.styleDescription` pour :

- `src/lib/i18n/en/editor.ts`
- `src/lib/i18n/fr/index.ts`
- `src/lib/i18n/es/index.ts`
- `src/lib/i18n/de/index.ts`
- `src/lib/i18n/id/index.ts`
- `src/lib/i18n/zh/index.ts`

N’affichez jamais directement `name` ou `description` dans un composant. Utilisez `LL`,
`getStyleName()` et `getStyleDescription()`.

Ne lancez pas manuellement la génération des types i18n : le hook pre-commit s’en charge.

### 6. Déclarer les dépendances

Les dépendances contextuelles restent gérées dans `StyleEditorSettings.svelte`, principalement dans
:

- `isStyleUnsupported()` pour les contrôles impossibles dans une cible ou une sélection ;
- `isStyleInactiveByDependency()` pour masquer un contrôle inutile tant que son prérequis est
  désactivé.

Lorsqu’un style enfant dépend d’un toggle ou d’un mode, ajoutez la règle correspondante. En mode
recherche, le contrôle peut rester visible mais doit être désactivé si son prérequis est inactif.

### 7. Préserver l’undo/redo

Une modification de valeur doit continuer à passer par `Style.svelte` ou être encapsulée avec
`ProjectHistoryManager`. Ne modifiez pas directement l’état d’un projet depuis un nouveau contrôle
sans historique.

### 8. Déterminer si une migration est nécessaire

Pour un simple ajout :

- `ensureStylesSchemaUpToDate()` ajoute le style manquant aux anciens projets ;
- les valeurs existantes ne sont pas écrasées ;
- les listes `options` des selects peuvent être rafraîchies ;
- aucune migration dédiée n’est normalement nécessaire.

Une migration dans `src/lib/services/MigrationService.ts` est nécessaire pour :

- renommer ou supprimer un identifiant existant ;
- déplacer réellement un style vers une autre catégorie technique ;
- convertir le type ou la forme d’une valeur ;
- transformer une ancienne valeur dont le sens a changé ;
- nettoyer un ancien champ persistant.

Les métadonnées `ui` ne sont pas enregistrées dans les projets. Elles sont non énumérables et sont
réhydratées depuis les JSON par `MigrationService.HydrateStyleEditorUiMetadata()` avant l’affichage
d’un projet existant. L’undo/redo les recopie également lors de la restauration d’un snapshot.

Changer uniquement `ui.panel`, `ui.groups` ou `ui.headerStyle` ne nécessite donc aucune migration
persistante.

## Vérifications avant de terminer

- Les deux JSON sont syntaxiquement valides.
- Chaque catégorie standard possède un `ui.panel` complet.
- Les définitions d’un même panneau sont identiques.
- Chaque `categoryOrder` est unique dans son panneau.
- Chaque `styleIds` référence un style existant dans le même fichier JSON.
- Chaque `headerStyle` référence un booléen de sa propre catégorie.
- Les styles partagés entre plusieurs catégories utilisent explicitement `shared: true`.
- Le nom et la description existent dans toutes les langues.
- Le type TypeScript de l’identifiant a été mis à jour.
- Les dépendances et le rendu CSS/export ont été vérifiés.
- Les modifications de valeur supportent toujours l’undo/redo.
- Les anciens projets ont été pris en compte ; une migration a été ajoutée si le stockage change.
- `git diff --check` ne signale aucune erreur.

## Erreurs fréquentes

- Ajouter le style au JSON sans l’ajouter à `StyleName`.
- Oublier les traductions ou n’en modifier qu’une seule.
- Changer `value` en pensant modifier les anciens projets : cette valeur est principalement un
  défaut pour les nouveaux styles/projets.
- Déplacer physiquement un style entre catégories pour un besoin uniquement visuel.
- Déclarer le même style dans plusieurs groupes visuels sans `shared: true` explicite.
- Utiliser `headerStyle` avec un style non booléen.
- Oublier la règle de dépendance qui masque les sous-réglages inutiles.
- Ajouter une catégorie sans `ui.panel`, puis chercher pourquoi elle n’apparaît pas.
- Coder un nouveau mapping de panneaux ou de groupes dans Svelte au lieu de modifier le JSON.
