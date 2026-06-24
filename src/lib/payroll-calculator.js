const round = n => Math.round(n * 100) / 100;

export function calculatePayroll({
  grossLPA,
  totalDaysInMonth,
  sundaysInMonth,
  alternateSaturdaysInMonth,
  unpaidLeavesTaken,
}) {
  const monthlyGross = round(grossLPA / 12);

  const basicPay = round(monthlyGross * 0.50);
  const hra = round(monthlyGross * 0.20);
  const dearnessAllowance = round(monthlyGross * 0.15);
  const conveyanceAllowance = round(monthlyGross * 0.10);
  const medicalAllowance = round(monthlyGross * 0.05);

  const pfBase = basicPay + dearnessAllowance;
  const employeePF = round(Math.min(pfBase * 0.12, 1800));

  const employeeESI = monthlyGross <= 21000 ? round(monthlyGross * 0.0075) : 0;

  const totalWorkingDays = totalDaysInMonth - sundaysInMonth - alternateSaturdaysInMonth;
  const salaryPerDay = totalWorkingDays > 0 ? round(monthlyGross / totalWorkingDays) : 0;
  const lossOfPayDeduction = round(salaryPerDay * unpaidLeavesTaken);

  const totalDeductions = round(employeePF + employeeESI + lossOfPayDeduction);
  const netTakeHome = round(monthlyGross - totalDeductions);

  return {
    earnings: {
      monthlyGross,
      basicPay,
      hra,
      dearnessAllowance,
      conveyanceAllowance,
      medicalAllowance,
    },
    deductions: {
      employeePF,
      employeeESI,
      lossOfPayDeduction,
      totalDeductions,
    },
    netTakeHome,
  };
}
