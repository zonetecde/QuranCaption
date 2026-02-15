/// Decrit une tentative de resolution d'un binaire.
#[derive(Clone, Debug, serde::Serialize)]
pub struct BinaryResolutionAttempt {
    /// Chemin ou nom tente.
    pub candidate: String,
    /// Source de la tentative (chemin embarque, PATH systeme, etc.).
    pub source: String,
    /// Resultat de la tentative.
    pub outcome: String,
    /// Detail eventuel en cas d'erreur.
    pub detail: Option<String>,
}

/// Erreur structuree de resolution d'un binaire.
#[derive(Clone, Debug)]
pub struct BinaryResolveError {
    /// Code d'erreur stable cote application.
    pub code: String,
    /// Message de diagnostic principal.
    pub details: String,
    /// Historique complet des tentatives.
    pub attempts: Vec<BinaryResolutionAttempt>,
}

/// Information de debug complete exposee pour diagnostic.
#[derive(Clone, Debug, serde::Serialize)]
pub struct BinaryResolveDebugInfo {
    /// Nom logique du binaire demande.
    pub name: String,
    /// Chemin resolu si succes.
    pub resolved_path: Option<String>,
    /// Code d'erreur en cas d'echec.
    pub error_code: Option<String>,
    /// Detail d'erreur en cas d'echec.
    pub error_details: Option<String>,
    /// Liste des tentatives effectuees.
    pub attempts: Vec<BinaryResolutionAttempt>,
}
