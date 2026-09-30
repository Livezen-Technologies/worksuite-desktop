import { useTab } from '../../../core/tab-context';
import { PageHead } from '../../hr/parts';
import { EnrollmentTable } from './CourseEnrollments';

/** Enrolments across courses, within the person's reach (§5.7): search, status, overdue. */
export default function Enrollments() {
  const { query } = useTab();
  return (
    <div className="flex flex-col gap-4 px-6 py-5">
      <PageHead title="Enrolments" sub="Everyone you may follow, across courses." />
      <EnrollmentTable path="/enrollments" showCourse fixed={query.get('overdue') === '1' ? { overdue: 1 } : undefined} />
    </div>
  );
}
