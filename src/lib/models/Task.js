import mongoose from 'mongoose';

const ProjectSchema = new mongoose.Schema({
  name:       { type: String, required: true },
  description:{ type: String, default: '' },
  team:       [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  deadline:   { type: String },
  progress:   { type: Number, default: 0 },
  status:     { type: String, enum: ['active','completed','on_hold'], default: 'active' },
  createdBy:  { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

const TaskSchema = new mongoose.Schema({
  title:      { type: String, required: true },
  description:{ type: String, default: '' },
  projectId:  { type: mongoose.Schema.Types.ObjectId, ref: 'Project', default: null },
  assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  assignedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  priority:   { type: String, enum: ['low','medium','high'], default: 'medium' },
  status:     { type: String, enum: ['To Do','In Progress','Completed','Blocked'], default: 'To Do' },
  due:        { type: String },
  hours:      { type: Number, default: 0 },
}, { timestamps: true });

export const Project = mongoose.models.Project || mongoose.model('Project', ProjectSchema);
export const Task    = mongoose.models.Task    || mongoose.model('Task', TaskSchema);
