type FloatingActionButtonsProps = {
  onAddStop: () => void
  onScrollToMap: () => void
  showScrollToMap: boolean
}

export const FloatingActionButtons = ({
  onAddStop,
  onScrollToMap,
  showScrollToMap,
}: FloatingActionButtonsProps) => {
  return (
    <div className="floating-action-buttons">
      {showScrollToMap && (
        <button
          className="fab fab-scroll-to-map"
          onClick={onScrollToMap}
          aria-label="Scroll to map"
          title="Scroll to map"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="18 15 12 9 6 15" />
          </svg>
        </button>
      )}
      <button
        className="fab fab-add-stop"
        onClick={onAddStop}
        aria-label="Add stop"
        title="Add stop"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      </button>
    </div>
  )
}
