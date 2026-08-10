// Wraps the substring of `text` matching `query` (case-insensitive) in a
// highlighted <mark> — used to show which part of an app name matched search.
export function HighlightMatch({ text, query }) {
  const q = query.trim();
  if (!q) return text;

  const idx = text.toLowerCase().indexOf(q.toLowerCase());
  if (idx === -1) return text;

  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-accent-purple/30 text-accent-purple rounded-[3px] px-[1px]">
        {text.slice(idx, idx + q.length)}
      </mark>
      {text.slice(idx + q.length)}
    </>
  );
}
