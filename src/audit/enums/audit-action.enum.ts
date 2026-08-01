export enum AuditAction {
  INSERT = 'insert',
  UPDATE = 'update',
  DELETE = 'delete',
  ERASE = 'erase',
  /**
   * F1.3.3 AC1 — "audit trail records: creation event, each view, each edit,
   * each signature action, and any version changes".
   *
   * The four actions above are all the TypeORM subscriber can produce, because
   * a subscriber only fires on a write. A view leaves no trace in the
   * database, so `VIEW` is recorded explicitly by the service that serves the
   * read. `SIGN` and `VERSION_CHANGE` are likewise domain events rather than
   * row changes: signing shows up to the subscriber as an ordinary UPDATE of
   * a signature row, which is true but not what an inspector is looking for.
   */
  VIEW = 'view',
  SIGN = 'sign',
  VERSION_CHANGE = 'version_change',
}
