export class DraftConflict extends Error {
  constructor(entity: string) { super(`This ${entity} changed since editing began. Copy your draft, then reload the accepted version before editing again.`); }
}
