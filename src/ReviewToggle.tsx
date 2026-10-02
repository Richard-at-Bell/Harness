export function ReviewToggle({ enabled, locked, onChange }: { enabled: boolean; locked: boolean; onChange: (enabled: boolean) => void }) {
  return <button type="button" className="review-toggle" role="switch" aria-label="Review changes" aria-checked={enabled} aria-describedby="agent-edit-policy" disabled={locked} onClick={() => onChange(!enabled)} title={locked ? 'Finish the current turn and any pending review to change this setting.' : 'Choose whether agent edits need your acceptance.'}>
    <span>Review changes</span>
    <span className="review-toggle-state">{enabled ? 'On' : 'Off'}</span>
    <span className="review-toggle-track" aria-hidden="true"><span /></span>
  </button>;
}
