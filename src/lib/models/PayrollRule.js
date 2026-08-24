import mongoose from 'mongoose';

const EarningComponentSchema = new mongoose.Schema({
  code:    { type: String, required: true },
  label:   { type: String, required: true },
  type:    { type: String, enum: ['percent_of_gross', 'percent_of_basic', 'fixed', 'remainder'], required: true },
  value:   { type: Number, default: 0 },
  taxable: { type: Boolean, default: true },
}, { _id: false });

const DeductionComponentSchema = new mongoose.Schema({
  code:               { type: String, required: true },
  label:              { type: String, required: true },
  type:               { type: String, enum: ['percent_of_basic_da', 'percent_of_gross', 'fixed'], required: true },
  value:              { type: Number, default: 0 },
  cap:                { type: Number, default: null },
  eligibilityMaxGross:{ type: Number, default: null },
  optional:           { type: Boolean, default: false },
  enabled:            { type: Boolean, default: true },
}, { _id: false });

const PayrollRuleSchema = new mongoose.Schema({
  name:      { type: String, required: true },
  isDefault: { type: Boolean, default: false },
  earnings:  [EarningComponentSchema],
  deductions:[DeductionComponentSchema],
  lopConfig: {
    basis:        { type: String, enum: ['working_days', 'calendar_days', 'fixed_26', 'fixed_30'], default: 'working_days' },
    deductFrom:   { type: String, enum: ['gross', 'basic', 'basic_da'], default: 'gross' },
    countHalfDay: { type: Boolean, default: true },
    graceDays:    { type: Number, default: 0 },
  },
}, { timestamps: true });

if (process.env.NODE_ENV === 'development') {
  delete mongoose.models.PayrollRule;
}

export default mongoose.models.PayrollRule || mongoose.model('PayrollRule', PayrollRuleSchema);
