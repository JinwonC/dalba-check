import { STEPS } from "@/lib/deals";
import type { T } from "@/lib/i18n";

/** Five-step progress strip: filled steps are complete, the ringed one is current. */
export default function Stepper({ done, labels, t }: { done: number; labels?: boolean; t: T }) {
  return (
    <ol className={labels ? "stepper stepper-labels" : "stepper"} aria-label={`${done} of ${STEPS.length} steps complete`}>
      {STEPS.map((s, i) => (
        <li key={s} className={i < done ? "on" : i === done ? "cur" : ""} title={`${i + 1}. ${t(s)}`}>
          <span className="stepper-dot">{i < done ? "✓" : i + 1}</span>
          {labels && <span className="stepper-text">{t(s)}</span>}
        </li>
      ))}
    </ol>
  );
}
