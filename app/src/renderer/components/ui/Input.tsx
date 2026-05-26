import { forwardRef } from "react";
import type { InputHTMLAttributes } from "react";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input(props, ref): JSX.Element {
    const { className = "", ...rest } = props;
    return (
      <input
        ref={ref}
        {...rest}
        className={
          "h-9 w-full rounded-md border border-border bg-background px-3 text-sm shadow-sm " +
          "placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 " +
          className
        }
      />
    );
  },
);
