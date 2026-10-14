// Pure sync decision logic (unit-tested): given what we know about a file locally, remotely and at
// the last successful sync, decide what to do.

export type SyncAction =
  | 'none'          // in sync
  | 'upload'        // changed here only (or new here)
  | 'download'      // changed there only (or new there)
  | 'deleteLocal'   // deleted remotely, unchanged here
  | 'deleteRemote'  // deleted here, unchanged there
  | 'compare'       // both exist, never synced: compare contents
  | 'conflict'      // changed on both sides
  | 'forget';       // gone on both sides

export interface Side { hash?: string; rev?: string }

/**
 * @param local  undefined if the file doesn't exist locally; `hash` = current content hash
 * @param remote undefined if the file doesn't exist on the provider; `rev` = provider revision
 * @param known  index entry from the last sync (hash + rev at that time), undefined if never synced
 */
export function planFile(local: Side | undefined, remote: Side | undefined, known: { hash: string; rev: string } | undefined): SyncAction {
  if (local && remote) {
    if (!known) return 'compare';
    const localChanged = local.hash !== known.hash;
    const remoteChanged = remote.rev !== known.rev;
    if (!localChanged && !remoteChanged) return 'none';
    if (localChanged && !remoteChanged) return 'upload';
    if (!localChanged && remoteChanged) return 'download';
    return 'conflict';
  }
  if (local && !remote) {
    if (!known) return 'upload';
    return local.hash === known.hash ? 'deleteLocal' : 'upload';
  }
  if (!local && remote) {
    if (!known) return 'download';
    return remote.rev === known.rev ? 'deleteRemote' : 'download';
  }
  return 'forget';
}

/** Name for the second copy kept when the user chooses "keep both". */
export function conflictCopyName(rel: string, source: string, date: Date): string {
  const stamp = date.toISOString().slice(0, 10);
  const slash = rel.lastIndexOf('/');
  const dot = rel.lastIndexOf('.');
  return dot > slash + 1 ? `${rel.slice(0, dot)} (conflict ${source} ${stamp})${rel.slice(dot)}` : `${rel} (conflict ${source} ${stamp})`;
}
