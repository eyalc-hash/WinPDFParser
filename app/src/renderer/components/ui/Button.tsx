import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "ghost" | "destructive";

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
}

const variants: Record<Variant, string> = {
  primary: "bg-primary text-primary-foreground hover:bg-primary/90",
  secondary: "bg-muted text-foreground hover:bg-muted/70",
  ghost: "bg-transparent text-foreground hover:bg-muted/50",
  destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
};

export function Button({
  variant = "secondary",
  className = "",
  ...rest
}: Props): JSX.Element {
  return (
    <button
      {...rest}
      className={
        "inline-flex h-9 items-center justify-center rounded-md px-3 text-sm font-medium " +
        "transition-colors disabled:cursor-not-allowed disabled:opacity-50 " +
        variants[variant] +
        (className ? " " + className : "")
      }
    />
  );
}
