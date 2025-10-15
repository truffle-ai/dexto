import React, { useState, useEffect } from 'react';
import './ExpandableImage.css';

interface ExpandableImageProps {
  src: string;
  alt: string;
  title?: string;
}

const ExpandableImage: React.FC<ExpandableImageProps> = ({ src, alt, title = "Image" }) => {
  const [isModalOpen, setIsModalOpen] = useState(false);

  const openModal = () => {
    setIsModalOpen(true);
    document.body.style.overflow = 'hidden'; // Prevent background scrolling
  };

  const closeModal = () => {
    setIsModalOpen(false);
    document.body.style.overflow = 'unset';
  };

  // Close modal on Escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closeModal();
      }
    };

    if (isModalOpen) {
      document.addEventListener('keydown', handleEscape);
    }

    return () => {
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isModalOpen]);

  // Cleanup body overflow on unmount
  useEffect(() => {
    return () => {
      document.body.style.overflow = 'unset';
    };
  }, []);

  return (
    <>
      {/* Regular image with click-to-expand */}
      <div className="image-thumbnail" onClick={openModal}>
        <div className="image-overlay">
          <div className="expand-hint">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="white" stroke="white" strokeWidth="2">
              <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>
            </svg>
            <span>Click to expand</span>
          </div>
        </div>
        <img src={src} alt={alt} className="thumbnail-image" />
      </div>

      {/* Full-screen modal */}
      {isModalOpen && (
        <div 
          className="image-modal-backdrop" 
          onClick={closeModal}
          role="dialog"
          aria-modal="true"
          aria-labelledby="modal-title"
        >
          <div className="image-modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="image-modal-header">
              <h3 id="modal-title">{title}</h3>
              <button className="image-close-btn" onClick={closeModal} aria-label="Close">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2"/>
                </svg>
              </button>
            </div>
            <div className="image-modal-body">
              <img src={src} alt={alt} className="modal-image" />
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default ExpandableImage;
