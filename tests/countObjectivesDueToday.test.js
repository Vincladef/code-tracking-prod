const { parisContext, __testables } = require("../functions/index.js");

const { countObjectivesDueToday } = __testables;

describe("countObjectivesDueToday", () => {
  function makeFetcher(map) {
    return jest.fn(async (uid, monthKey) => map[monthKey] || []);
  }

  test("counts objectives stored with Paris-midnight ISO strings and timestamps", async () => {
    const context = parisContext(new Date("2024-07-15T08:00:00.000Z"));
    const monthKey = context.dateIso.slice(0, 7);

    const reminderIso = "2024-07-15T00:00:00+02:00";
    const reminderTimestamp = {
      toDate: () => new Date("2024-07-15T00:00:00+02:00"),
    };

    const fetcher = makeFetcher({
      [monthKey]: [
        { id: "iso", notifyAt: reminderIso },
        { id: "timestamp", notifyAt: reminderTimestamp },
        { id: "other", notifyAt: "2024-07-16T00:00:00+02:00" },
      ],
    });

    const count = await countObjectivesDueToday("user", context, { fetchObjectivesByMonth: fetcher });
    expect(count).toBe(2);
    expect(fetcher).toHaveBeenCalled();
  });
});
