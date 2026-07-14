import type { GenerationHistoryItem } from '../types';

type HistoryPanelProps = {
  history: GenerationHistoryItem[];
  favoriteIds: string[];
  onSelect: (item: GenerationHistoryItem) => void;
  onEditImage: (item: GenerationHistoryItem) => void;
  onRegionEditImage: (item: GenerationHistoryItem) => void;
  onClear: () => void;
};

export function HistoryPanel({ history, favoriteIds, onSelect, onEditImage, onRegionEditImage, onClear }: HistoryPanelProps) {
  return (
    <section className="history-panel embedded-history-panel">
      <div className="history-head">
        <div>
          <h2>最近生成</h2>
        </div>
        <button className="tiny-button linkish-button" type="button" onClick={onClear} disabled={history.length === 0}>
          清空历史
        </button>
      </div>

      {history.length === 0 ? (
        <div className="empty-state history-empty">
          <p>当前还没有历史记录。成功生成后会自动保存在此浏览器中。</p>
        </div>
      ) : (
        <div className="history-strip history-grid">
          {history.map((item) => (
            <article key={item.id} className="history-card history-item">
              <button
                className="history-card-main"
                type="button"
                onClick={() => onSelect(item)}
              >
              <div className="history-thumb-wrap history-thumb">
                <img src={item.imageDataUrl} alt={item.prompt} />
                {favoriteIds.includes(item.id) ? <span className="favorite-badge">收藏</span> : null}
              </div>
              <div className="history-card-body">
                <strong className="history-title">{item.prompt}</strong>
                <p className="history-meta">
                  {item.width > 0 && item.height > 0 ? `${item.width} x ${item.height}` : '未知尺寸'}
                  {' · '}
                  {new Date(item.createdAt).toLocaleString()}
                </p>
              </div>
              </button>
              <div className="history-card-actions">
                <button className="ghost-button history-action-button" type="button" onClick={() => onEditImage(item)}>
                  继续编辑
                </button>
                <button className="ghost-button history-action-button" type="button" onClick={() => onRegionEditImage(item)}>
                  局部编辑
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
