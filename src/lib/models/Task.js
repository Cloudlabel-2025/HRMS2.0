import mongoose from 'mongoose';

const ProjectSchema = new mongoose.Schema({
  name:        { type: String, required: true, trim: true, maxlength: 30 },
  description: { type: String, required: true },
  team:        [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  responsibleTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  departments: [{ type: String }],
  startDate:   { type: String, required: true },
  endDate:     { type: String, required: true },
  progress:    { type: Number, default: 0 },
  status:      { type: String, enum: ['active','completed','on_hold'], default: 'active' },
  approvalStatus:    { type: String, enum: ['approved','pending','rejected'], default: 'approved' },
  approvalRequired:  { type: Boolean, default: false },
  approvalRequestedAt:{ type: Date, default: null },
  approvedBy:        { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  approvedAt:        { type: Date, default: null },
  rejectionComment:  { type: String, default: '' },
  createdBy:   { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  reminderSent:{ type: Boolean, default: false },
}, {
  timestamps: true,
  toJSON: {
    transform(doc, ret) {
      if (ret.departments === undefined) ret.departments = [];
      if (ret.startDate === undefined) ret.startDate = '';
      if (ret.endDate === undefined) ret.endDate = '';
      return ret;
    },
  },
});

const TaskSchema = new mongoose.Schema({
  title:      { type: String, required: true, trim: true, maxlength: 30 },
  description:{ type: String, required: true },
  projectId:  { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true },
  assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  assignedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  priority:   { type: String, enum: ['low','medium','high'], required: true },
  status:     { type: String, enum: ['To Do','In Progress','Pending','Completed','Blocked'], default: 'To Do' },
  statusHistory: [{ status: { type: String }, changedAt: { type: Date, default: Date.now }, changedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' } }],
  activityLog: [{ date: { type: String, required: true }, comment: { type: String, required: true }, addedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, addedAt: { type: Date, default: Date.now } }],
  due:        { type: String, required: true },
  reminderSent:{ type: Boolean, default: false },
}, { timestamps: true });

// Force re-register to pick up schema changes (critical for Next.js HMR)
if (mongoose.models.Project) delete mongoose.models.Project;
export const Project = mongoose.model('Project', ProjectSchema);

if (mongoose.models.Task) delete mongoose.models.Task;
export const Task    = mongoose.model('Task', TaskSchema);
