'use client';

export default function Pagination({ currentPage, totalPages, onPageChange, totalItems, pageSize }) {
  if (totalPages <= 1) return null;

  const getPagesRange = () => {
    const range = [];
    const maxVisible = 5;
    
    if (totalPages <= maxVisible) {
      for (let i = 1; i <= totalPages; i++) {
        range.push(i);
      }
    } else {
      let start = Math.max(1, currentPage - 2);
      let end = Math.min(totalPages, currentPage + 2);
      
      if (start === 1) {
        end = maxVisible;
      } else if (end === totalPages) {
        start = totalPages - maxVisible + 1;
      }
      
      for (let i = start; i <= end; i++) {
        range.push(i);
      }
    }
    return range;
  };

  const pages = getPagesRange();

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '16px 20px',
      borderTop: '1px solid #f1f5f9',
      background: '#fff',
      flexWrap: 'wrap',
      gap: 12
    }}>
      <div style={{ fontSize: 13, color: '#64748b', fontWeight: 500 }}>
        {totalItems ? (
          <>
            Showing <strong style={{ color: '#0f172a' }}>{Math.min(totalItems, (currentPage - 1) * pageSize + 1)}</strong> to <strong style={{ color: '#0f172a' }}>{Math.min(totalItems, currentPage * pageSize)}</strong> of <strong style={{ color: '#0f172a' }}>{totalItems}</strong> results
          </>
        ) : (
          `Page ${currentPage} of ${totalPages}`
        )}
      </div>

      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <button
          type="button"
          className="btn btn-sm btn-outline-secondary"
          onClick={() => onPageChange(1)}
          disabled={currentPage === 1}
          style={{ minHeight: 32, padding: '0 10px', fontSize: 12, borderRadius: 8, display: 'flex', alignItems: 'center', background: 'transparent' }}
        >
          <i className="bi bi-chevron-double-left" />
        </button>
        <button
          type="button"
          className="btn btn-sm btn-outline-secondary"
          onClick={() => onPageChange(currentPage - 1)}
          disabled={currentPage === 1}
          style={{ minHeight: 32, padding: '0 10px', fontSize: 12, borderRadius: 8, display: 'flex', alignItems: 'center', background: 'transparent' }}
        >
          <i className="bi bi-chevron-left" />
        </button>

        {pages[0] > 1 && (
          <>
            <button
              type="button"
              className="btn btn-sm btn-outline-secondary"
              onClick={() => onPageChange(1)}
              style={{ minHeight: 32, padding: '0 12px', fontSize: 12, borderRadius: 8, background: 'transparent' }}
            >
              1
            </button>
            {pages[0] > 2 && <span style={{ padding: '2px 6px', color: '#94a3b8', fontSize: 12 }}>...</span>}
          </>
        )}

        {pages.map(page => (
          <button
            key={page}
            type="button"
            className={`btn btn-sm ${currentPage === page ? 'btn-primary' : 'btn-outline-secondary'}`}
            onClick={() => onPageChange(page)}
            style={{
              minHeight: 32,
              padding: '0 12px',
              fontSize: 12,
              borderRadius: 8,
              fontWeight: 600,
              background: currentPage === page ? 'var(--primary)' : 'transparent',
              color: currentPage === page ? '#fff' : '#475569',
              borderColor: currentPage === page ? 'var(--primary)' : '#e2e8f0',
            }}
          >
            {page}
          </button>
        ))}

        {pages[pages.length - 1] < totalPages && (
          <>
            {pages[pages.length - 1] < totalPages - 1 && <span style={{ padding: '2px 6px', color: '#94a3b8', fontSize: 12 }}>...</span>}
            <button
              type="button"
              className="btn btn-sm btn-outline-secondary"
              onClick={() => onPageChange(totalPages)}
              style={{ minHeight: 32, padding: '0 12px', fontSize: 12, borderRadius: 8, background: 'transparent' }}
            >
              {totalPages}
            </button>
          </>
        )}

        <button
          type="button"
          className="btn btn-sm btn-outline-secondary"
          onClick={() => onPageChange(currentPage + 1)}
          disabled={currentPage === totalPages}
          style={{ minHeight: 32, padding: '0 10px', fontSize: 12, borderRadius: 8, display: 'flex', alignItems: 'center', background: 'transparent' }}
        >
          <i className="bi bi-chevron-right" />
        </button>
        <button
          type="button"
          className="btn btn-sm btn-outline-secondary"
          onClick={() => onPageChange(totalPages)}
          disabled={currentPage === totalPages}
          style={{ minHeight: 32, padding: '0 10px', fontSize: 12, borderRadius: 8, display: 'flex', alignItems: 'center', background: 'transparent' }}
        >
          <i className="bi bi-chevron-double-right" />
        </button>
      </div>
    </div>
  );
}
