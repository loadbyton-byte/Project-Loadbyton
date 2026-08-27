import { useState } from 'react';
import { api } from '../../lib/api.js';
import { Button, Textarea } from '../../components/ui.jsx';
import { IconStar } from '../../components/icons.jsx';
import { useToasts } from '../../components/Toast.jsx';

/**
 * RatingPanel — extracted from JobDetail.jsx (925 lines → smaller).
 * Props: { job, onSubmit }
 *  - job: full job object (needs job.id)
 *  - onSubmit: callback after successful rating (e.g. reload job detail)
 */
export default function RatingPanel({ job, onSubmit }) {
  const [score, setScore] = useState(5);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const { addToast } = useToasts();

  const jobId = job?.id;

  async function submit() {
    if (!jobId) return;
    setBusy(true);
    try {
      await api.rateJob(jobId, { score, comment });
      setDone(true);
      if (onSubmit) await onSubmit();
    } catch (err) {
      addToast({ type: 'system_message', title: 'Rating not saved', body: err.message });
    } finally {
      setBusy(false);
    }
  }

  if (done) return <p className="text-sm text-ink-muted">Thanks for the rating.</p>;

  return (
    <div className="space-y-3">
      <div className="flex gap-1" role="radiogroup" aria-label="Rating">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => setScore(n)}
            aria-label={`${n} star${n > 1 ? 's' : ''}`}
            aria-pressed={n === score}
            className="rounded p-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-primary"
          >
            <IconStar
              size={22}
              style={{ color: n <= score ? 'var(--brand-accent)' : 'var(--border-strong)' }}
              aria-hidden="true"
            />
          </button>
        ))}
      </div>
      <Textarea
        rows={2}
        placeholder="Optional comment"
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        aria-label="Rating comment"
      />
      <Button onClick={submit} loading={busy} disabled={!jobId}>
        Submit rating
      </Button>
    </div>
  );
}
