package com.psyclefinder.app.widget;

/**
 * Which layout a widget of a given size gets, and what fits in it. A classic App Widget cannot
 * measure itself (RemoteViews has no "view that fits"), so what the iPhone widget settles with
 * ViewThatFits is settled here from the size the launcher reports, in dp, and the member's
 * font scale.
 *
 * PURE, like PsyncSnapshot (no android.* import): PsyncWidgetPlanTest runs it on the JVM.
 *
 * Nothing here is measured: a plan's height is a SUM of its rows (neededHeightDp), and a size
 * gets the first step of a ladder whose sum fits it. The ladder gives way as the iPhone's
 * does - the long class name first (one line, and then PsyncWidgetViews prints its head), then
 * the size of the digits and the padding - so that the seat badge, the LAST row of the card
 * and therefore the one a too-tall card cuts, is the last thing at risk.
 */
public final class PsyncWidgetPlan {

    /** COMPACT: day word, TIME, class name, seat. WIDE: the same beside each other, plus who and where, plus following classes. */
    public enum Bucket { COMPACT, WIDE }

    /** From this width on the wide layout is used: four cells on most launchers (70 x 4 - 30 = 250dp). */
    static final int WIDE_FROM_DP = 250;
    /** The width assumed for a COMPACT card whose launcher reports none: two cells on most. */
    static final int COMPACT_TYPICAL_DP = 156;

    // -- The layouts' own numbers ---------------------------------------------------------------
    // res/values/widget_styles.xml (the sp sizes, the badge's padding) and
    // res/layout/widget_next_class_compact.xml / _wide.xml (the tiles, the margins), copied by
    // hand. tests/suites/19-android-project.js reads both sides: change one, change the other.
    static final int DAY_SP = 13;
    static final int TITLE_SP = 14;
    static final int TITLE_WIDE_SP = 15;
    static final int BODY_SP = 12;
    static final int SEAT_SP = 12;
    static final int TILE_DP = 24;
    static final int TILE_WIDE_DP = 28;
    /** The seat badge's padding: 4 above its words and 4 below, 9 before and 9 after. */
    static final int SEAT_PAD_TALL_DP = 8;
    static final int SEAT_PAD_WIDE_DP = 18;
    /** The margin above the seat badge, COMPACT and WIDE. */
    static final int SEAT_GAP_DP = 6;
    static final int SEAT_GAP_WIDE_DP = 5;
    /** The margin above "Instructor (middle dot) Place". */
    static final int WHO_GAP_DP = 3;
    /** The hairline over the following rows: 1dp, with 8 above it and 6 below. */
    static final int RULE_DP = 15;
    /** The margin above the second following row. */
    static final int ROW_GAP_DP = 3;
    /** WIDE: the margin between the time column and the class beside it. */
    static final int COLUMN_GAP_DP = 14;

    // -- What is assumed about type, never measured ---------------------------------------------
    /** A line of text is this many times its size tall (Roboto without font padding: 1.17). */
    static final double LINE_PER_SIZE = 1.18;
    /** "18:30" in the condensed bold face is about this many times its size wide. */
    static final double TIME_WIDTH_PER_SIZE = 2.3;
    /** "Tomorrow", the longest day word, in the condensed bold face. */
    static final double DAY_WIDTH_PER_SIZE = 4.3;
    /** One character of the seat badge at 1sp: half an em, on the generous side for a condensed face. */
    static final double SEAT_CHAR_PER_SIZE = 0.5;
    /** "4 bikes": the badge is never planned narrower than its counted form. */
    static final int MIN_SEAT_CHARS = 7;

    public final Bucket bucket;
    /** The hero time's size, in dp (not sp: at the largest font scale the digits would leave the card). */
    public final int timeSizeDp;
    /** Lines the class name may take. On ONE line PsyncWidgetViews prints the name's head. */
    public final int titleLines;
    /** Following classes shown under the rule, WIDE only: 0, 1 or 2. */
    public final int rows;
    /** The card's inner padding, in dp. */
    public final int paddingDp;
    /** Characters the seat badge has room for: PsyncSnapshot.Entry.seatBadge counts the seats beyond it. */
    public final int seatChars;
    /** The member's font scale, as the sums took it in (1 = the default). Every row but the time is sp. */
    public final float fontScale;

    private PsyncWidgetPlan(Bucket bucket, int timeSizeDp, int titleLines, int rows, int paddingDp,
                            int widthDp, float fontScale) {
        this.bucket = bucket;
        this.timeSizeDp = timeSizeDp;
        this.titleLines = titleLines;
        this.rows = rows;
        this.paddingDp = paddingDp;
        this.fontScale = fontScale;
        this.seatChars = seatChars(bucket, widthDp, paddingDp, timeSizeDp, fontScale);
    }

    /** The bucket for a reported width; an unknown width (0 or less) is COMPACT, which fits everywhere. */
    public static Bucket bucketFor(int widthDp) {
        return widthDp >= WIDE_FROM_DP ? Bucket.WIDE : Bucket.COMPACT;
    }

    /** The plan for the size a launcher reports, at the default font scale. */
    public static PsyncWidgetPlan forSize(int widthDp, int heightDp) {
        return forSize(widthDp, heightDp, 1f);
    }

    /**
     * The plan for the size a launcher reports and the member's font scale
     * (Configuration.fontScale). 0 or less = unknown: the roomy plan of the narrow bucket.
     */
    public static PsyncWidgetPlan forSize(int widthDp, int heightDp, float fontScale) {
        return forBucket(bucketFor(widthDp), widthDp, heightDp, fontScale);
    }

    /** The plan for a bucket the caller has chosen (the debug preview), sized like forSize. */
    public static PsyncWidgetPlan forBucket(Bucket bucket, int widthDp, int heightDp, float fontScale) {
        PsyncWidgetPlan[] ladder = ladder(bucket, widthDp, scale(fontScale));
        if (heightDp <= 0) {
            return ladder[0];
        }
        for (PsyncWidgetPlan step : ladder) {
            if (step.neededHeightDp() <= heightDp) {
                return step;
            }
        }
        // Shorter than every step (a launcher's landscape box, a very large font on one row of
        // cells): the smallest. Its badge may then be cut - ios-app/ANDROID.md's checklist.
        return ladder[ladder.length - 1];
    }

    /** The steps a bucket gives way by, roomiest first. */
    static PsyncWidgetPlan[] ladder(Bucket bucket, int widthDp, float fontScale) {
        if (bucket == Bucket.WIDE) {
            // Following rows go first, then the name's second line.
            return new PsyncWidgetPlan[] {
                new PsyncWidgetPlan(Bucket.WIDE, 40, 2, 2, 12, widthDp, fontScale),
                new PsyncWidgetPlan(Bucket.WIDE, 40, 2, 1, 12, widthDp, fontScale),
                new PsyncWidgetPlan(Bucket.WIDE, 40, 2, 0, 12, widthDp, fontScale),
                new PsyncWidgetPlan(Bucket.WIDE, 40, 1, 0, 12, widthDp, fontScale),
            };
        }
        // The card's inner width at two cells (110dp) is 86dp: "18:30" fits there at 34, and
        // at 40 from 130dp.
        int timeSize = widthDp > 0 && widthDp < 130 ? 34 : 40;
        return new PsyncWidgetPlan[] {
            new PsyncWidgetPlan(Bucket.COMPACT, timeSize, 2, 0, 12, widthDp, fontScale),
            new PsyncWidgetPlan(Bucket.COMPACT, timeSize, 1, 0, 12, widthDp, fontScale),
            new PsyncWidgetPlan(Bucket.COMPACT, 30, 1, 0, 8, widthDp, fontScale),
            // 110dp, the smallest a launcher may make it (xml/next_class_widget_info.xml).
            new PsyncWidgetPlan(Bucket.COMPACT, 24, 1, 0, 6, widthDp, fontScale),
        };
    }

    /**
     * The height this plan's rows add up to, in dp, at its font scale - the FULL card: with a
     * seat badge, and (WIDE) with "Instructor (middle dot) Place". A class without them has
     * room to spare.
     */
    public int neededHeightDp() {
        if (bucket == Bucket.WIDE) {
            int when = line(DAY_SP * fontScale) + line(timeSizeDp);
            int what = Math.max(TILE_WIDE_DP, titleLines * line(TITLE_WIDE_SP * fontScale))
                + WHO_GAP_DP + line(BODY_SP * fontScale)
                + SEAT_GAP_WIDE_DP + SEAT_PAD_TALL_DP + line(SEAT_SP * fontScale);
            int following = rows == 0 ? 0
                : RULE_DP + rows * line(BODY_SP * fontScale) + (rows - 1) * ROW_GAP_DP;
            return 2 * paddingDp + Math.max(when, what) + following;
        }
        // The name row holds the pictogram tile too: with one line it is the TILE's height.
        return 2 * paddingDp + line(DAY_SP * fontScale) + line(timeSizeDp)
            + Math.max(TILE_DP, titleLines * line(TITLE_SP * fontScale))
            + SEAT_GAP_DP + SEAT_PAD_TALL_DP + line(SEAT_SP * fontScale);
    }

    /** The height of one line of text of the given size, in dp, rounded up. */
    static int line(double sizeDp) {
        return (int) Math.ceil(sizeDp * LINE_PER_SIZE);
    }

    /** A usable font scale: Android offers 0.85 to 2; anything that is not a number is 1. */
    static float scale(float fontScale) {
        if (Float.isNaN(fontScale) || fontScale <= 0f) {
            return 1f;
        }
        return Math.max(0.5f, Math.min(fontScale, 3f));
    }

    private static int seatChars(Bucket bucket, int widthDp, int paddingDp, int timeSizeDp, float fontScale) {
        int card = widthDp > 0 ? widthDp : (bucket == Bucket.WIDE ? WIDE_FROM_DP : COMPACT_TYPICAL_DP);
        int room = card - 2 * paddingDp - SEAT_PAD_WIDE_DP;
        if (bucket == Bucket.WIDE) {
            // The badge sits beside the time column, which is as wide as its widest line.
            double column = Math.max(timeSizeDp * TIME_WIDTH_PER_SIZE, DAY_SP * fontScale * DAY_WIDTH_PER_SIZE);
            room -= (int) Math.ceil(column) + COLUMN_GAP_DP;
        }
        int chars = (int) Math.floor(room / (SEAT_SP * fontScale * SEAT_CHAR_PER_SIZE));
        return Math.max(MIN_SEAT_CHARS, chars);
    }
}
