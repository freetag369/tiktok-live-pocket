/** ユーザー一覧共通のメモ表示。空欄は行を作らない。 */
export function MemoLines({ note, previousNote }: { note?: string; previousNote?: string }) {
  return <>
    {note ? <div className="memo-line">📝 {note}</div> : null}
    {previousNote ? <div className="memo-line">前回：{previousNote}</div> : null}
  </>;
}
