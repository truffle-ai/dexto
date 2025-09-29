import React, { useState } from 'react';
import clsx from 'clsx';
import styles from './ZoomableImage.module.css';

type Props = {
    src: string;
    alt: string;
    caption?: string;
    className?: string;
};

export default function ZoomableImage({ src, alt, caption, className }: Props) {
    const [expanded, setExpanded] = useState(false);

    return (
        <>
            <figure className={clsx(styles.figure, className)}>
                <img
                    src={src}
                    alt={alt}
                    className={styles.thumbnail}
                    onClick={() => setExpanded(true)}
                />
                {caption && <figcaption>{caption}</figcaption>}
            </figure>
            {expanded && (
                <div className={styles.backdrop} role="presentation" onClick={() => setExpanded(false)}>
                    <img src={src} alt={alt} className={styles.fullImage} />
                </div>
            )}
        </>
    );
}
