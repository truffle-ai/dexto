import React, { useEffect, useState } from 'react';
import { motion, useSpring, useTransform } from 'framer-motion';

interface AnimatedNumberProps {
    value: number;
    className?: string;
    duration?: number;
}

export function AnimatedNumber({ value, className, duration = 1000 }: AnimatedNumberProps) {
    const [displayValue, setDisplayValue] = useState(0);

    useEffect(() => {
        const start = displayValue;
        const end = value;
        const startTime = Date.now();

        const animate = () => {
            const now = Date.now();
            const progress = Math.min((now - startTime) / duration, 1);

            // Easing function (easeOutExpo)
            const eased = progress === 1 ? 1 : 1 - Math.pow(2, -10 * progress);
            const current = Math.floor(start + (end - start) * eased);

            setDisplayValue(current);

            if (progress < 1) {
                requestAnimationFrame(animate);
            }
        };

        animate();
    }, [value, duration]);

    return <span className={className}>{displayValue.toLocaleString()}</span>;
}
