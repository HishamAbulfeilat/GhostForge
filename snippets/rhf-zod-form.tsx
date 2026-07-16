import * as React from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';

const formSchema = z.object({
  fullName: z.string().min(2, 'Full name is required'),
  department: z.enum(['engineering', 'design', 'operations'], {
    message: 'Please choose a department'
  }),
  acceptTerms: z.boolean().refine((value) => value, 'You must accept the terms'),
  attachments: z
    .custom<FileList | null>(
      (value) => value === null || value instanceof FileList,
      'Invalid file upload'
    )
    .refine(
      (files) => !files || files.length === 0 || files[0].size <= 5 * 1024 * 1024,
      'Each file must be 5 MB or less'
    )
});

type FormValues = z.infer<typeof formSchema>;

export function EmployeeRequestForm() {
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors }
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      fullName: '',
      department: 'engineering',
      acceptTerms: false,
      attachments: null
    }
  });

  const onSubmit = handleSubmit(async (values) => {
    setIsSubmitting(true);

    try {
      const files = values.attachments ? Array.from(values.attachments) : [];
      await new Promise((resolve) => setTimeout(resolve, 800));
      console.log({ ...values, attachments: files.map((file) => file.name) });
    } finally {
      setIsSubmitting(false);
    }
  });

  return (
    <form className="space-y-5 rounded-2xl border border-slate-200 p-6" onSubmit={onSubmit}>
      <div>
        <label className="mb-1 block text-sm font-medium text-slate-700">Full name</label>
        <input
          className="w-full rounded-md border border-slate-300 px-3 py-2"
          placeholder="Enter full name"
          {...register('fullName')}
        />
        {errors.fullName ? (
          <p className="mt-1 text-sm text-red-600">{errors.fullName.message}</p>
        ) : null}
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium text-slate-700">Department</label>
        <select
          className="w-full rounded-md border border-slate-300 px-3 py-2"
          {...register('department')}
        >
          <option value="engineering">Engineering</option>
          <option value="design">Design</option>
          <option value="operations">Operations</option>
        </select>
        {errors.department ? (
          <p className="mt-1 text-sm text-red-600">{errors.department.message}</p>
        ) : null}
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium text-slate-700">Attachments</label>
        <input
          type="file"
          multiple
          className="block w-full text-sm text-slate-600"
          {...register('attachments')}
        />
        {errors.attachments ? (
          <p className="mt-1 text-sm text-red-600">{errors.attachments.message}</p>
        ) : null}
      </div>

      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input type="checkbox" {...register('acceptTerms')} />
        <span>I agree to the terms and conditions</span>
      </label>
      {errors.acceptTerms ? (
        <p className="text-sm text-red-600">{errors.acceptTerms.message}</p>
      ) : null}

      <button
        type="submit"
        disabled={isSubmitting}
        className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
      >
        {isSubmitting ? 'Submitting...' : 'Submit request'}
      </button>
    </form>
  );
}
