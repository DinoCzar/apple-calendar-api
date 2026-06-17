interface GroceryListModalProps {
  text: string;
  days: number;
  onClose: () => void;
}

export default function GroceryListModal({
  text,
  days,
  onClose,
}: GroceryListModalProps) {
  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Clipboard may be unavailable
    }
  }

  return (
    <div
      className="modal-overlay"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="grocery-list-title"
      >
        <div className="modal-header">
          <h2 id="grocery-list-title">Grocery list — next {days} days</h2>
          <button type="button" className="btn-secondary" onClick={onClose}>
            Close
          </button>
        </div>
        <textarea
          className="grocery-list-output"
          readOnly
          value={text}
          aria-label="Generated grocery list"
        />
        <div className="form-actions">
          <button type="button" className="btn-primary" onClick={handleCopy}>
            Copy list
          </button>
        </div>
      </div>
    </div>
  );
}
