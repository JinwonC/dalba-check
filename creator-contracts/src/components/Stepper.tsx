import { STEPS } from "@/lib/deals";

/** Five-step progress strip: filled steps are complete, the ringed one is current. */
export default function Stepper({ done, labels }: { done: number; labels?: boolean }) {
  return (
    <ol className={labels ? "stepper stepper-labels" : "stepper"} aria-label={`${done} of ${STEPS.length} steps complete`}>
      {STEPS.map((s, i) => (
        <li key={s} className={i < done ? "on" : i === done ? "cur" : ""} title={`${i + 1}. ${s}`}>
          <span className="stepper-dot">{i < done ? "✓" : i + 1}</span>
          {labels && <span className="stepper-text">{s}</span>}
        </li>
      ))}
    </ol>
  );
}
