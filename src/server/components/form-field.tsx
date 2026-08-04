import type { ComponentChildren } from "preact";

interface FormFieldProps {
  label: string;
  id: string;
  children: ComponentChildren;
}

export const FormField = ({ label, id, children }: FormFieldProps) => (
  <div className="form-field">
    <label htmlFor={id}>{label}</label>
    {children}
  </div>
);
