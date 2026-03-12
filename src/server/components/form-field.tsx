interface FormFieldProps {
  label: string;
  id: string;
  children: React.ReactNode;
}

export const FormField = ({ label, id, children }: FormFieldProps) => (
  <div className="form-field">
    <label htmlFor={id}>{label}</label>
    {children}
  </div>
);
