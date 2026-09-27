import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Link } from "react-router-dom";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode;
  variant?: "primary" | "secondary" | "ghost";
  to?: string;
  icon?: ReactNode;
};

export function Button({ children, variant = "primary", to, icon, className = "", ...props }: Props) {
  const classes = `button button--${variant} ${className}`;
  if (to) return <Link className={classes} to={to}>{icon}{children}</Link>;
  return <button className={classes} {...props}>{icon}{children}</button>;
}
