"use client";
import * as React from "react";

interface BaseProps {
  label?: string;
  hint?: string;
  error?: string;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}

type InputProps = BaseProps & React.InputHTMLAttributes<HTMLInputElement>;

export const TextInput = React.forwardRef<HTMLInputElement, InputProps>(function TextInput(
  { label, hint, error, leftIcon, rightIcon, className = "", ...rest },
  ref
) {
  return (
    <label className="block">
      {label && <span className="text-sm font-medium heading">{label}</span>}
      <div className="relative mt-1">
        {leftIcon && <span className="absolute left-3 top-1/2 -translate-y-1/2 muted">{leftIcon}</span>}
        <input
          ref={ref}
          className={`input ${leftIcon ? "pl-10" : ""} ${rightIcon ? "pr-10" : ""} ${error ? "border-danger" : ""} ${className}`}
          {...rest}
        />
        {rightIcon && <span className="absolute right-3 top-1/2 -translate-y-1/2 muted">{rightIcon}</span>}
      </div>
      {hint && !error && <p className="mt-1 text-xs muted">{hint}</p>}
      {error && <p className="mt-1 text-xs text-danger">{error}</p>}
    </label>
  );
});

type TextareaProps = BaseProps & React.TextareaHTMLAttributes<HTMLTextAreaElement>;

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { label, hint, error, className = "", ...rest },
  ref
) {
  return (
    <label className="block">
      {label && <span className="text-sm font-medium heading">{label}</span>}
      <textarea
        ref={ref}
        className={`input mt-1 min-h-[110px] resize-y ${error ? "border-danger" : ""} ${className}`}
        {...rest}
      />
      {hint && !error && <p className="mt-1 text-xs muted">{hint}</p>}
      {error && <p className="mt-1 text-xs text-danger">{error}</p>}
    </label>
  );
});

type SelectProps = BaseProps & React.SelectHTMLAttributes<HTMLSelectElement>;

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { label, hint, error, className = "", children, ...rest },
  ref
) {
  return (
    <label className="block">
      {label && <span className="text-sm font-medium heading">{label}</span>}
      <select
        ref={ref}
        className={`input mt-1 appearance-none bg-[length:16px] bg-no-repeat bg-[right_12px_center] pr-10 ${error ? "border-danger" : ""} ${className}`}
        style={{
          backgroundImage: `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%2364748B' stroke-width='2'><polyline points='6 9 12 15 18 9'/></svg>")`,
        }}
        {...rest}
      >
        {children}
      </select>
      {hint && !error && <p className="mt-1 text-xs muted">{hint}</p>}
      {error && <p className="mt-1 text-xs text-danger">{error}</p>}
    </label>
  );
});
