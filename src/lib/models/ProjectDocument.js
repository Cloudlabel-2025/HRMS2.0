import mongoose from 'mongoose';

const ProjectDocumentSchema = new mongoose.Schema({
  projectId:  { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
  name:       { type: String, required: true },
  fileUrl:    { type: String, required: true },
  fileSize:   { type: String },
  fileType:   { type: String },
  uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  taskId:     { type: mongoose.Schema.Types.ObjectId, ref: 'Task', default: null },
}, { timestamps: true });

export default mongoose.models.ProjectDocument || mongoose.model('ProjectDocument', ProjectDocumentSchema);
