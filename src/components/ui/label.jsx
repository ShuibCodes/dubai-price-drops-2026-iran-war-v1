export function Label({ children, className = "", htmlFor }) {
  return (
    <label className={`az-label uppercase ${className}`} htmlFor={htmlFor}>
      {children}
    </label>
  );
}
