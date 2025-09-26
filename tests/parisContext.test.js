const { parisContext } = require("../functions/index.js");

describe("parisContext", () => {
  test("uses Paris local date for DST period", () => {
    const context = parisContext(new Date("2024-09-26T10:00:00.000Z"));
    expect(context.dateIso).toBe("2024-09-26");
    expect(context.selectedDate).toBeInstanceOf(Date);
  });

  test("uses Paris local date for standard time", () => {
    const context = parisContext(new Date("2024-12-15T10:00:00.000Z"));
    expect(context.dateIso).toBe("2024-12-15");
  });
});
