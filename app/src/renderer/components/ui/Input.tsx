import type { InputHTMLAttributes } from "react";

export function Input(props: InputHTMLAttributes<HTMLInputElement>): JSX.Element {
  const { className = "", ...rest } = props;
  return (
    <input
      {...rest}
      className={
        "h-9 w-full rounded-md border border-border bg-background px-3 text-sm " +
        "placeholder:text-muted-foreground focus:border-primary focus:outline-none " +
        className
      }
    />
  );
}
