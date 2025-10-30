import React, { useState, useEffect, useRef, useCallback } from 'react';
import './ExpandableImage.css';

interface ExpandableImageProps {
  src: string;
  alt: string;
  title?: string;
  width?: string | number;
  videoSrc?: string; // Optional: MP4 video source for better performance
}

const ExpandableImage: React.FC<ExpandableImageProps> = ({
  src,
  alt,
  title = alt,
  width = 600,
  videoSrc
}) => {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isInView, setIsInView] = useState(false);
  const thumbnailRef = useRef<HTMLDivElement>(null);

  const openModal = () => {
    setIsModalOpen(true);
    document.body.style.overflow = 'hidden';
  };

  const closeModal = useCallback(() => {
    setIsModalOpen(false);
    document.body.style.overflow = 'unset';
  }, [setIsModalOpen]);

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
  }, [isModalOpen, closeModal]);

  // Cleanup body overflow on unmount
  useEffect(() => {
    return () => {
      document.body.style.overflow = 'unset';
    };
  }, []);

  // Intersection Observer for lazy loading with margin
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setIsInView(true);
            observer.disconnect();
          }
        });
      },
      {
        rootMargin: '50px', // Start loading 50px before entering viewport
      }
    );

    if (thumbnailRef.current) {
      observer.observe(thumbnailRef.current);
    }

    return () => {
      observer.disconnect();
    };
  }, []);

  return (
    <>
      {/* Thumbnail image/video with click-to-expand */}
      <div className="image-thumbnail-container" ref={thumbnailRef}>
        <div className="image-thumbnail" onClick={openModal}>
          <div className="image-overlay">
            <div className="expand-hint">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="white" stroke="white" strokeWidth="2">
                <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>
              </svg>
              <span>Click to expand</span>
            </div>
          </div>
          {isInView && (
            <>
              {videoSrc ? (
                <video
                  src={videoSrc}
                  width={width}
                  autoPlay
                  loop
                  muted
                  playsInline
                  preload="metadata"
                  style={{ display: 'block' }}
                />
              ) : (
                <img src={src} alt={alt} width={width} loading="lazy" decoding="async" />
              )}
            </>
          )}
          {!isInView && (
            <div style={{ width, height: '400px', backgroundColor: 'var(--ifm-color-emphasis-200)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <span style={{ color: 'var(--ifm-color-emphasis-600)' }}>Loading...</span>
            </div>
          )}
        </div>
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
              {videoSrc ? (
                <video
                  src={videoSrc}
                  autoPlay
                  loop
                  muted
                  playsInline
                  controls
                  style={{ display: 'block', maxWidth: '100%', maxHeight: '85vh' }}
                />
              ) : (
                <img src={src} alt={alt} loading="lazy" decoding="async" />
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default ExpandableImage;
