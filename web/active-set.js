// Adapter implementations remain available for rollback and explicit diagnostics.
// This list controls the current experiment, not the viability of a whole service.
export const SELECTION_EDITION='videoseed-1.4';
export const ACTIVE_PROVIDERS=['videoseed'];
export const TECHNICAL_PROVIDERS=['apple','blender'];
export const archiveDiagnostic=()=>new URLSearchParams(location.search).get('archive')==='1';
