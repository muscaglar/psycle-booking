package com.psyclefinder.app.widget;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/**
 * PsyncWidgetPlan on the JVM: which layout a reported size gets, and what is left out when the
 * card is short or the member's font is large. The numbers are dp, as a launcher reports them
 * (OPTION_APPWIDGET_*), and a font scale as Configuration.fontScale gives it.
 *
 * Nothing here can MEASURE a layout: the plan's sums are held to the layouts' own sizes by
 * tests/suites/19-android-project.js, and whether the sums are right about a real card is the
 * emulator job's pictures and ios-app/ANDROID.md's checklist.
 */
public class PsyncWidgetPlanTest {

    private static final PsyncWidgetPlan.Bucket COMPACT = PsyncWidgetPlan.Bucket.COMPACT;
    private static final PsyncWidgetPlan.Bucket WIDE = PsyncWidgetPlan.Bucket.WIDE;

    /** The card's rows, added up HERE from the named constants: the second statement of neededHeightDp's sum. */
    private static int rowsAddedUp(PsyncWidgetPlan plan) {
        double scale = plan.fontScale;
        int padding = 2 * plan.paddingDp;
        int day = PsyncWidgetPlan.line(PsyncWidgetPlan.DAY_SP * scale);
        int time = PsyncWidgetPlan.line(plan.timeSizeDp);
        int seatWords = PsyncWidgetPlan.line(PsyncWidgetPlan.SEAT_SP * scale);
        if (plan.bucket == COMPACT) {
            int name = Math.max(PsyncWidgetPlan.TILE_DP, plan.titleLines * PsyncWidgetPlan.line(PsyncWidgetPlan.TITLE_SP * scale));
            int badge = PsyncWidgetPlan.SEAT_GAP_DP + PsyncWidgetPlan.SEAT_PAD_TALL_DP + seatWords;
            return padding + day + time + name + badge;
        }
        int bodyLine = PsyncWidgetPlan.line(PsyncWidgetPlan.BODY_SP * scale);
        int name = Math.max(PsyncWidgetPlan.TILE_WIDE_DP, plan.titleLines * PsyncWidgetPlan.line(PsyncWidgetPlan.TITLE_WIDE_SP * scale));
        int beside = name + PsyncWidgetPlan.WHO_GAP_DP + bodyLine
            + PsyncWidgetPlan.SEAT_GAP_WIDE_DP + PsyncWidgetPlan.SEAT_PAD_TALL_DP + seatWords;
        int following = plan.rows == 0 ? 0
            : PsyncWidgetPlan.RULE_DP + plan.rows * bodyLine + (plan.rows - 1) * PsyncWidgetPlan.ROW_GAP_DP;
        return padding + Math.max(day + time, beside) + following;
    }

    private static String shape(PsyncWidgetPlan plan) {
        return plan.bucket + " time " + plan.timeSizeDp + " lines " + plan.titleLines + " rows " + plan.rows + " padding " + plan.paddingDp;
    }

    @Test
    public void theWideLayoutStartsAtFourCells() {
        assertEquals(COMPACT, PsyncWidgetPlan.bucketFor(110));
        assertEquals(COMPACT, PsyncWidgetPlan.bucketFor(249));
        assertEquals(WIDE, PsyncWidgetPlan.bucketFor(250));
        assertEquals(WIDE, PsyncWidgetPlan.bucketFor(400));
        assertEquals("a launcher that reports no width", COMPACT, PsyncWidgetPlan.bucketFor(0));
    }

    /**
     * The point of the class: whatever the size and the font, the plan a height gets NEEDS no
     * more than that height - so the seat badge, the last row, is not what a short card cuts -
     * and it is the ROOMIEST step that fits. Below the smallest step there is nothing left to
     * give up, and the smallest is what is drawn.
     */
    @Test
    public void everyPlanFitsTheHeightThatChoseItAndIsTheRoomiestThatDoes() {
        float[] scales = {0.85f, 1f, 1.15f, 1.3f, 1.5f, 1.8f, 2f};
        int[][] widths = {{110, 120, 129, 130, 156, 200, 249, 0}, {250, 300, 328, 400, 0}};
        PsyncWidgetPlan.Bucket[] buckets = {COMPACT, WIDE};
        for (int b = 0; b < buckets.length; b++) {
            for (int width : widths[b]) {
                for (float scale : scales) {
                    PsyncWidgetPlan[] ladder = PsyncWidgetPlan.ladder(buckets[b], width, scale);
                    for (int i = 0; i < ladder.length; i++) {
                        assertEquals("both sums agree: " + shape(ladder[i]) + " at " + scale, rowsAddedUp(ladder[i]), ladder[i].neededHeightDp());
                        assertTrue("each step needs less than the one before: " + shape(ladder[i]),
                            i == 0 || ladder[i].neededHeightDp() < ladder[i - 1].neededHeightDp());
                    }
                    PsyncWidgetPlan smallest = ladder[ladder.length - 1];
                    for (int height = 40; height <= 420; height++) {
                        PsyncWidgetPlan plan = PsyncWidgetPlan.forBucket(buckets[b], width, height, scale);
                        String where = shape(plan) + " for " + width + " x " + height + " at " + scale;
                        if (height < smallest.neededHeightDp()) {
                            assertEquals("nothing fits: the smallest step, " + where, shape(smallest), shape(plan));
                            continue;
                        }
                        assertTrue("it fits: " + where + " needs " + plan.neededHeightDp(), plan.neededHeightDp() <= height);
                        for (PsyncWidgetPlan step : ladder) {
                            if (shape(step).equals(shape(plan))) {
                                break;
                            }
                            assertTrue("a roomier step did not fit: " + shape(step) + " before " + where, step.neededHeightDp() > height);
                        }
                    }
                }
            }
        }
    }

    /** The sums at the default font, written out: a changed constant shows up here as a changed number. */
    @Test
    public void theSumsAtTheDefaultFontScale() {
        PsyncWidgetPlan[] compact = PsyncWidgetPlan.ladder(COMPACT, 156, 1f);
        assertEquals(4, compact.length);
        assertEquals("12 + 16 + 48 + 2 x 17 + (6 + 8 + 15) + 12", 151, compact[0].neededHeightDp());
        assertEquals("one line of the name is the 24dp TILE beside it, not a 17dp line", 141, compact[1].neededHeightDp());
        assertEquals("8 + 16 + 36 + 24 + 29 + 8", 121, compact[2].neededHeightDp());
        assertEquals("the smallest step is the smallest height a launcher may give the widget", 110, compact[3].neededHeightDp());

        PsyncWidgetPlan[] narrow = PsyncWidgetPlan.ladder(COMPACT, 120, 1f);
        assertEquals("34dp digits: 7 less", 144, narrow[0].neededHeightDp());

        PsyncWidgetPlan[] wide = PsyncWidgetPlan.ladder(WIDE, 328, 1f);
        assertEquals(4, wide.length);
        assertEquals("12 + (36 + 3 + 15 + 5 + 8 + 15) + (15 + 15 + 3 + 15) + 12", 154, wide[0].neededHeightDp());
        assertEquals(136, wide[1].neededHeightDp());
        assertEquals(106, wide[2].neededHeightDp());
        assertEquals("one line: the 28dp tile", 98, wide[3].neededHeightDp());
    }

    @Test
    public void aCompactCardGivesWayFromTheNameDown() {
        PsyncWidgetPlan roomy = PsyncWidgetPlan.forSize(156, 172);
        assertEquals("COMPACT time 40 lines 2 rows 0 padding 12", shape(roomy));

        PsyncWidgetPlan narrow = PsyncWidgetPlan.forSize(120, 160);
        assertEquals("18:30 must fit 96dp", "COMPACT time 34 lines 2 rows 0 padding 12", shape(narrow));

        assertEquals("two lines need 151", "COMPACT time 40 lines 1 rows 0 padding 12", shape(PsyncWidgetPlan.forSize(156, 150)));
        assertEquals("COMPACT time 40 lines 2 rows 0 padding 12", shape(PsyncWidgetPlan.forSize(156, 151)));
        assertEquals("COMPACT time 40 lines 1 rows 0 padding 12", shape(PsyncWidgetPlan.forSize(156, 141)));
        // 130 to 137 used to get the 40dp plan, which needs 141: the badge lost up to 8dp.
        assertEquals("COMPACT time 30 lines 1 rows 0 padding 8", shape(PsyncWidgetPlan.forSize(156, 140)));
        assertEquals("COMPACT time 30 lines 1 rows 0 padding 8", shape(PsyncWidgetPlan.forSize(156, 130)));
        assertEquals("COMPACT time 30 lines 1 rows 0 padding 8", shape(PsyncWidgetPlan.forSize(156, 121)));
        // 110 to 118 used to get the 30dp plan, which needs 121.
        assertEquals("COMPACT time 24 lines 1 rows 0 padding 6", shape(PsyncWidgetPlan.forSize(156, 120)));
        assertEquals("COMPACT time 24 lines 1 rows 0 padding 6", shape(PsyncWidgetPlan.forSize(110, 110)));
        assertEquals("shorter than anything: still the smallest", "COMPACT time 24 lines 1 rows 0 padding 6", shape(PsyncWidgetPlan.forSize(110, 80)));
    }

    @Test
    public void aWideCardShowsAsManyFollowingClassesAsItsHeightAllows() {
        assertEquals(2, PsyncWidgetPlan.forSize(328, 172).rows);
        assertEquals(2, PsyncWidgetPlan.forSize(328, 154).rows);
        assertEquals(1, PsyncWidgetPlan.forSize(328, 153).rows);
        assertEquals(1, PsyncWidgetPlan.forSize(328, 136).rows);
        assertEquals(0, PsyncWidgetPlan.forSize(328, 135).rows);
        assertEquals("the rows go before the name's second line", 2, PsyncWidgetPlan.forSize(328, 135).titleLines);
        assertEquals(2, PsyncWidgetPlan.forSize(328, 106).titleLines);
        assertEquals(1, PsyncWidgetPlan.forSize(328, 105).titleLines);
        assertEquals(WIDE, PsyncWidgetPlan.forSize(328, 105).bucket);
        assertEquals(40, PsyncWidgetPlan.forSize(328, 90).timeSizeDp);
    }

    /** Every row but the time is sp: a larger font is a shorter card, as far as the plan goes. */
    @Test
    public void aLargerFontGivesWayEarlier() {
        assertEquals("COMPACT time 40 lines 2 rows 0 padding 12", shape(PsyncWidgetPlan.forSize(156, 170, 1f)));
        assertEquals("at 1.3 two lines still fit 170", "COMPACT time 40 lines 2 rows 0 padding 12", shape(PsyncWidgetPlan.forSize(156, 170, 1.3f)));
        assertEquals("at 1.5 the name goes to one line (and PsyncWidgetViews prints its head)",
            "COMPACT time 40 lines 1 rows 0 padding 12", shape(PsyncWidgetPlan.forSize(156, 170, 1.5f)));
        assertEquals("at 2.0 the digits and the padding give way too",
            "COMPACT time 30 lines 1 rows 0 padding 8", shape(PsyncWidgetPlan.forSize(156, 170, 2f)));
        assertTrue("and the badge still fits", PsyncWidgetPlan.forSize(156, 170, 2f).neededHeightDp() <= 170);

        assertEquals(2, PsyncWidgetPlan.forSize(328, 172, 1f).rows);
        assertEquals(1, PsyncWidgetPlan.forSize(328, 172, 1.3f).rows);
        assertEquals(0, PsyncWidgetPlan.forSize(328, 172, 2f).rows);

        assertEquals("a smaller font has room for more", 2, PsyncWidgetPlan.forSize(328, 150, 0.85f).rows);
    }

    @Test
    public void aFontScaleThatIsNotOneIsReadAsOne() {
        float[] odd = {0f, -1f, Float.NaN};
        for (float scale : odd) {
            assertEquals(shape(PsyncWidgetPlan.forSize(156, 150, 1f)), shape(PsyncWidgetPlan.forSize(156, 150, scale)));
            assertEquals(1f, PsyncWidgetPlan.forSize(156, 150, scale).fontScale, 0f);
        }
        assertEquals("absurdly large is large, not unbounded", 3f, PsyncWidgetPlan.forSize(156, 150, 40f).fontScale, 0f);
        assertEquals(1f, PsyncWidgetPlan.forSize(156, 150).fontScale, 0f);
    }

    /** What the seat badge has room for: PsyncSnapshot.Entry.seatBadge counts the seats beyond it. */
    @Test
    public void theSeatBadgesRoomFollowsTheWidthAndTheFont() {
        int twoCells = PsyncWidgetPlan.forSize(156, 172).seatChars;
        assertTrue("\"Machines 12 & 14\" is 16 characters: whole at two ordinary cells (" + twoCells + ")", twoCells >= 16);
        assertTrue("\"Bikes 12 & 14 & 16 & 18\" is 23: counted there", twoCells < 23);

        int smallest = PsyncWidgetPlan.forSize(110, 140).seatChars;
        assertTrue("\"Bikes 5 & 6\" is 11: whole at the narrowest (" + smallest + ")", smallest >= 11);
        assertTrue("\"Machines 12 & 14\" is counted there", smallest < 16);

        int wide = PsyncWidgetPlan.forSize(328, 172).seatChars;
        assertTrue("four bikes are all named on a wide card (" + wide + ")", wide >= 23);
        assertTrue("less room beside the time column than the card is wide", wide < (328 - 24 - 18) / 6);

        assertTrue("a larger font has room for fewer", PsyncWidgetPlan.forSize(156, 172, 2f).seatChars <= twoCells / 2 + 1);
        assertTrue("never planned narrower than \"4 bikes\"", PsyncWidgetPlan.forSize(110, 110, 3f).seatChars >= 7);
        assertTrue("an unknown width is two ordinary cells", PsyncWidgetPlan.forSize(0, 0).seatChars == twoCells);
    }

    @Test
    public void anUnknownSizeIsTheRoomyPlan() {
        assertEquals("COMPACT time 40 lines 2 rows 0 padding 12", shape(PsyncWidgetPlan.forSize(0, 0)));
        assertEquals("WIDE time 40 lines 2 rows 2 padding 12", shape(PsyncWidgetPlan.forBucket(WIDE, 0, 0, 1f)));
        assertEquals("a known width, an unknown height", "WIDE time 40 lines 2 rows 2 padding 12", shape(PsyncWidgetPlan.forSize(328, 0)));
    }
}
