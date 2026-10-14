/**
 * The Tasks app's editor as a frame and parts (Projects SRS v1.2 §14.2, PRJ-TED-02): `TaskDetail` composes them
 * for the Tasks app, `projects/ProjectTaskModal` for a task on a project.
 */
export { TaskEditorFrame, useSaving } from './Frame';
export {
  Assignee,
  AttachmentCard,
  Attachments,
  Checklist,
  Chip,
  Conversation,
  Description,
  LockReason,
  Organisation,
  Progress,
  Row,
  Tags,
  Title,
  When,
  aside,
  inputsOf,
  useAttachments,
  useLockReason,
  useUploads,
  type SendComment,
} from './parts';
