import mongoose from 'mongoose';

const DepartmentSchema = new mongoose.Schema({
  name:               { type: String, required: true, unique: true },
  head:               { type: String, default: '' },
  members:            { type: Number, default: 0 },
  visibleDepartments: { type: [String], default: [] },
}, { timestamps: true });

export default mongoose.models.Department || mongoose.model('Department', DepartmentSchema);
