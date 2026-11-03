import React from 'react';

interface AISearchIconProps {
  className?: string;
}

/**
 * Custom vector SVG combining a sleek magnifying glass lens with an AI 4-point star sparkle inside
 */
export const AISearchIcon: React.FC<AISearchIconProps> = ({ className = 'w-4 h-4' }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
  >
    {/* Magnifying glass circle */}
    <circle
      cx="10.5"
      cy="10.5"
      r="6.8"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
    />
    {/* Handle */}
    <path
      d="M15.6 15.6L20.5 20.5"
      stroke="currentColor"
      strokeWidth="2.1"
      strokeLinecap="round"
    />
    {/* Inner AI 4-point star sparkle */}
    <path
      d="M10.5 6.4L11.45 9.55L14.6 10.5L11.45 11.45L10.5 14.6L9.55 11.45L6.4 10.5L9.55 9.55L10.5 6.4Z"
      fill="currentColor"
    />
    {/* Secondary micro-sparkle on top right rim */}
    <path
      d="M18.2 3.2L18.65 4.85L20.3 5.3L18.65 5.75L18.2 7.4L17.75 5.75L16.1 5.3L17.75 4.85L18.2 3.2Z"
      fill="currentColor"
    />
  </svg>
);
