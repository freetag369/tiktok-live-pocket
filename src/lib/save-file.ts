/**
 * ファイルを端末に渡す。
 * iOS(ホーム画面から起動した PWA を含む)では共有シート(Web Share API)が最も確実で、
 * 「ファイルに保存」「AirDrop」「メール」などを選べる。使えない環境では download リンクに落とす。
 */
export type SaveOutcome = 'shared' | 'downloaded' | 'cancelled';

export async function saveTextFile(name: string, text: string, mime: string): Promise<SaveOutcome> {
  const blob = new Blob([text], { type: mime });
  const file = new File([blob], name, { type: mime });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (typeof nav.share === 'function' && typeof nav.canShare === 'function' && nav.canShare({ files: [file] })) {
    try {
      await nav.share({ files: [file], title: name });
      return 'shared';
    } catch (e) {
      // ユーザーが共有シートを閉じた(AbortError)。それ以外はダウンロードにフォールバック。
      if ((e as Error)?.name === 'AbortError') return 'cancelled';
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return 'downloaded';
}

export function readTextFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result ?? ''));
    r.onerror = () => reject(r.error ?? new Error('読み込みに失敗しました'));
    r.readAsText(file);
  });
}
