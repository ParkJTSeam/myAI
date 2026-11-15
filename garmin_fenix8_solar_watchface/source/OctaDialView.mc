import Toybox.Graphics;
import Toybox.Lang;
import Toybox.Math;
import Toybox.System;
import Toybox.Time;
import Toybox.Time.Gregorian;
import Toybox.WatchUi;

// Analog-digital hybrid watch face ported from a 454x454 Amazfit (HMDIAL) design
// to the fenix 8 Solar MIP displays (260x260 / 280x280, 64 colors).
// All layout coordinates below are in the original 454px design space and are
// scaled at runtime, so the same code serves both case sizes.
class OctaDialView extends WatchUi.WatchFace {

    private const DESIGN_SIZE = 454.0f;

    // Hand shapes in design units: [distance from pivot toward tip, half width].
    // Listed tip -> tail along one side; mirrored for the other side.
    private const HOUR_BODY   = [[108, 0], [100, 5], [94, 9], [82, 14], [22, 16], [-44, 20], [-53, 13]];
    private const HOUR_LUME   = [[92, 0], [82, 9], [30, 10]];
    private const MINUTE_BODY = [[180, 0], [166, 7], [154, 11], [16, 13], [-62, 20], [-71, 14]];
    private const MINUTE_LUME = [[164, 0], [154, 6], [34, 6]];

    private const HAND_COLOR = 0x000000;
    private const HAND_EDGE  = 0x555555;
    private const LUME_COLOR = 0xFFFFFF;
    private const DIGIT_COLOR = 0xAAAAAA;

    private var _scale as Float = 1.0f;
    private var _cx as Number = 0;
    private var _cy as Number = 0;

    private var _background as BitmapResource?;
    private var _cap as BitmapResource?;
    private var _week as Array<BitmapResource> = [] as Array<BitmapResource>;
    private var _timeDigits as Array<BitmapResource> = [] as Array<BitmapResource>;
    private var _dateDigits as Array<BitmapResource> = [] as Array<BitmapResource>;

    function initialize() {
        WatchFace.initialize();
    }

    function onLayout(dc as Dc) as Void {
        _scale = dc.getWidth() / DESIGN_SIZE;
        _cx = dc.getWidth() / 2;
        _cy = dc.getHeight() / 2;

        _background = WatchUi.loadResource(Rez.Drawables.Background) as BitmapResource;
        _cap = WatchUi.loadResource(Rez.Drawables.Cap) as BitmapResource;

        _week = loadAll([
            Rez.Drawables.Week0, Rez.Drawables.Week1, Rez.Drawables.Week2, Rez.Drawables.Week3,
            Rez.Drawables.Week4, Rez.Drawables.Week5, Rez.Drawables.Week6
        ]);
        _timeDigits = loadAll([
            Rez.Drawables.T0, Rez.Drawables.T1, Rez.Drawables.T2, Rez.Drawables.T3, Rez.Drawables.T4,
            Rez.Drawables.T5, Rez.Drawables.T6, Rez.Drawables.T7, Rez.Drawables.T8, Rez.Drawables.T9
        ]);
        _dateDigits = loadAll([
            Rez.Drawables.D0, Rez.Drawables.D1, Rez.Drawables.D2, Rez.Drawables.D3, Rez.Drawables.D4,
            Rez.Drawables.D5, Rez.Drawables.D6, Rez.Drawables.D7, Rez.Drawables.D8, Rez.Drawables.D9
        ]);
    }

    private function loadAll(ids as Array<ResourceId>) as Array<BitmapResource> {
        var out = new Array<BitmapResource>[ids.size()];
        for (var i = 0; i < ids.size(); i++) {
            out[i] = WatchUi.loadResource(ids[i]) as BitmapResource;
        }
        return out;
    }

    // Design-space coordinate -> screen pixel.
    private function px(v as Number) as Number {
        return Math.round(v * _scale).toNumber();
    }

    function onUpdate(dc as Dc) as Void {
        var clock = System.getClockTime();
        var info = Gregorian.info(Time.now(), Time.FORMAT_SHORT);

        dc.drawBitmap(0, 0, _background as BitmapResource);

        // Day-of-week sub dial. Images are Monday-first; Garmin uses 1 = Sunday.
        var weekIndex = ((info.day_of_week as Number) + 5) % 7;
        dc.drawBitmap(px(47), px(180), _week[weekIndex]);

        drawDigitalTime(dc, clock);
        drawDate(dc, info.month as Number, info.day as Number);

        // Analog hands (no seconds hand: MIP watch faces refresh once per minute).
        var minuteAngle = clock.min * Math.PI / 30.0;
        var hourAngle = ((clock.hour % 12) * 60 + clock.min) * Math.PI / 360.0;
        drawHand(dc, hourAngle, HOUR_BODY, HOUR_LUME);
        drawHand(dc, minuteAngle, MINUTE_BODY, MINUTE_LUME);

        var cap = _cap as BitmapResource;
        dc.drawBitmap(_cx - cap.getWidth() / 2, _cy - cap.getHeight() / 2, cap);
    }

    // Lower LCD row: HH:MM (colon is part of the background).
    private function drawDigitalTime(dc as Dc, clock as ClockTime) as Void {
        var hour = clock.hour;
        var showLeadingZero = true;
        if (!System.getDeviceSettings().is24Hour) {
            hour = hour % 12;
            if (hour == 0) {
                hour = 12;
            }
            showLeadingZero = false;
        }
        var y = px(320);
        if (hour >= 10 || showLeadingZero) {
            dc.drawBitmap(px(237), y, _timeDigits[hour / 10]);
        }
        dc.drawBitmap(px(256), y, _timeDigits[hour % 10]);
        dc.drawBitmap(px(281), y, _timeDigits[clock.min / 10]);
        dc.drawBitmap(px(300), y, _timeDigits[clock.min % 10]);
    }

    // Upper LCD row: M.DD style, both fields right-aligned like a classic LCD.
    private function drawDate(dc as Dc, month as Number, day as Number) as Void {
        var y = px(277);
        if (month >= 10) {
            dc.drawBitmap(px(282), y, _dateDigits[month / 10]);
        }
        dc.drawBitmap(px(298), y, _dateDigits[month % 10]);
        // Date separator dot (drawn, since a 3px bitmap disappears when downscaled).
        var dotSize = px(3) < 2 ? 2 : px(3);
        dc.setColor(DIGIT_COLOR, Graphics.COLOR_TRANSPARENT);
        dc.fillRectangle(px(318), px(301), dotSize, dotSize);
        if (day >= 10) {
            dc.drawBitmap(px(326), y, _dateDigits[day / 10]);
        }
        dc.drawBitmap(px(342), y, _dateDigits[day % 10]);
    }

    private function drawHand(dc as Dc, angle as Float or Double, body as Array, lume as Array) as Void {
        var sin = Math.sin(angle);
        var cos = Math.cos(angle);
        var outline = handPolygon(body, sin, cos);
        dc.setColor(HAND_EDGE, Graphics.COLOR_TRANSPARENT);
        dc.setPenWidth(1);
        for (var i = 0; i < outline.size(); i++) {
            var a = outline[i] as Array<Number>;
            var b = outline[(i + 1) % outline.size()] as Array<Number>;
            dc.drawLine(a[0], a[1], b[0], b[1]);
        }
        dc.setColor(HAND_COLOR, Graphics.COLOR_TRANSPARENT);
        dc.fillPolygon(outline);
        dc.setColor(LUME_COLOR, Graphics.COLOR_TRANSPARENT);
        dc.fillPolygon(handPolygon(lume, sin, cos));
    }

    // Builds a closed polygon from a half-profile, rotated clockwise from 12 o'clock.
    private function handPolygon(profile as Array, sin as Float or Double, cos as Float or Double) as Array<Array<Number>> {
        var n = profile.size();
        var pts = [] as Array<Array<Number>>;
        // Left side tip -> tail, then right side tail -> tip (skip zero-width points twice).
        for (var i = 0; i < n; i++) {
            var p = profile[i] as Array<Number>;
            pts.add(rotate(p[0], -p[1], sin, cos));
        }
        for (var i = n - 1; i >= 0; i--) {
            var p = profile[i] as Array<Number>;
            if (p[1] != 0) {
                pts.add(rotate(p[0], p[1], sin, cos));
            }
        }
        return pts;
    }

    private function rotate(d as Number, w as Number, sin as Float or Double, cos as Float or Double) as Array<Number> {
        var ds = d * _scale;
        var ws = w * _scale;
        var x = _cx + ds * sin + ws * cos;
        var y = _cy - ds * cos + ws * sin;
        return [Math.round(x).toNumber(), Math.round(y).toNumber()];
    }

    function onEnterSleep() as Void {
    }

    function onExitSleep() as Void {
    }
}
