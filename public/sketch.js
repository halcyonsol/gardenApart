// Drawing is local; growth and weather always come from the Node server.
window.createGardenSketch = function () {
  const container = document.querySelector('#garden-canvas');
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  new p5(p => {
    const visibleGrowth = Array(9).fill(0);
    let previousRound = '';
    let completedAt = null;
    p.setup = () => {
      p.createCanvas(container.clientWidth, container.clientHeight).parent(container);
      p.pixelDensity(Math.min(window.devicePixelRatio || 1, 2));
      p.frameRate(reducedMotion.matches ? 8 : 30);
      p.canvas.setAttribute('aria-hidden', 'true');
    };

    function hill(color, start, c1, c2, end) {
      const w = p.width, h = p.height;
      p.noStroke(); p.fill(color); p.beginShape(); p.vertex(0, h * start);
      p.bezierVertex(w * .28, h * c1); p.bezierVertex(w * .63, h * c2); p.bezierVertex(w, h * end);
      p.vertex(w, h); p.vertex(0, h); p.endShape(p.CLOSE);
    }

    function drawSky(state, time) {
      const w = p.width, h = p.height;
      const light = state.sunlight / 100;
      // Twilight becomes daylight as the Keeper increases sunlight.
      const daylight = p.constrain((light - .3) / .4, 0, 1);
      const night = 1 - daylight;
      const top = p.lerpColor(p.color('#26324e'), p.color('#788f9c'), daylight);
      const bottom = p.lerpColor(p.color('#596976'), p.color('#c5baa0'), daylight);
      p.background(top);
      p.noFill();
      p.strokeWeight(4);
      for (let y = 0; y <= h; y += 4) {
        p.stroke(p.lerpColor(top, bottom, y / h)); p.line(0, y, w, y);
      }
      p.strokeWeight(1);
      p.noStroke();
      for (let i = 0; i < 55; i++) {
        const x = ((i * 173 + 41) % 997) / 997 * w;
        const y = ((i * 71 + 33) % 257) / 257 * h * .45;
        p.fill(229, 228, 207, (75 + Math.sin(time * .65 + i) * 45) * night);
        p.circle(x, y, i % 4 === 0 ? 2 : 1);
      }
      // Crossfade the moon and sun. Clip the crescent instead of painting a
      // dark circle over it, so its cutout matches the changing sky exactly.
      for (let i = 5; i > 0; i--) {
        p.fill(232, 204, 160, 4 + daylight * 5); p.circle(w * .79, h * .17, 45 + i * 23);
      }
      const skyX = w * .79, skyY = h * .17;
      p.fill(244, 220, 169, daylight * 255);
      p.circle(skyX, skyY, 39);
      const context = p.drawingContext;
      context.save();
      context.beginPath();
      context.arc(skyX, skyY, 17.5, 0, Math.PI * 2);
      context.moveTo(skyX + 5.5, skyY - 5);
      context.arc(skyX - 10, skyY - 5, 15.5, 0, Math.PI * 2);
      context.clip('evenodd');
      p.fill(232, 204, 160, night * 255);
      p.circle(skyX, skyY, 35);
      context.restore();
      hill('#627878', .48, .29, .53, .39);
      hill('#4e696a', .54, .38, .47, .53);
      hill('#3b5b5e', .62, .48, .56, .6);
      hill('#304d53', .81, .66, .75, .68);
      // Small grasses give the foreground depth without obscuring the plots.
      p.strokeWeight(1);
      for (let i = 0; i < 95; i++) {
        const x = ((i * 131 + 19) % 997) / 997 * w;
        const y = h * (.53 + ((i * 43) % 97) / 97 * .46);
        p.stroke(127, 152, 124, i % 3 === 0 ? 100 : 45);
        p.line(x, y, x + Math.sin(time * .7 + i) * 2 - 2, y - 3 - i % 8);
      }
    }

    function flower(plot, x, y, time) {
      const target = plot.stage === 'empty' ? 0 : plot.growth;
      visibleGrowth[plot.id] += (target - visibleGrowth[plot.id]) * (reducedMotion.matches ? 1 : .08);
      const growth = visibleGrowth[plot.id];
      const scale = Math.min(p.width / 680, 1.2);
      const size = Math.max(.64, scale);
      p.push(); p.translate(x, y); p.scale(size);
      p.noStroke(); p.fill('#253f46'); p.ellipse(0, 4, 91, 20);
      p.noFill(); p.stroke('#8ea18a60'); p.ellipse(0, 0, 88, 20);
      if (plot.stage === 'empty') {
        p.stroke('#b5ba9560'); p.line(-3, 0, 3, 0); p.line(0, -3, 0, 3); p.pop(); return;
      }
      p.noStroke(); p.fill('#e8cca0'); p.ellipse(0, -2, 7, 4);
      if (growth < .12) {
        p.noFill(); p.stroke(232, 204, 160, 50 + 20 * Math.sin(time)); p.ellipse(0, 0, 13 + growth * 50, 6 + growth * 20);
        p.pop(); return;
      }
      const height = 13 + growth * 66;
      const sway = Math.sin(time * .8 + plot.id) * 2.5;
      const bend = plot.wilted ? height * .28 : sway;
      const tipY = -height + (plot.wilted ? height * .23 : 0);
      p.noFill(); p.stroke(plot.wilted ? '#8d9177' : '#9eb690'); p.strokeWeight(2);
      p.bezier(0, 0, -3, -height * .4, bend - 8, tipY, bend, tipY);
      p.noStroke(); p.fill(plot.wilted ? '#8d9177' : '#91ad88');
      p.push(); p.translate(-2, -height * .34); p.rotate(-.55); p.ellipse(-8, -3, 20, 7); p.pop();
      if (growth > .3) {
        p.push(); p.translate(0, -height * .58); p.rotate(.5); p.ellipse(9, -3, 22, 8); p.pop();
      }
      p.translate(bend, tipY);
      const opening = Math.max(0, (growth - .65) / .35);
      if (opening <= .02) {
        p.fill(plot.wilted ? '#9f969f' : '#d1b9d8'); p.ellipse(0, -3, 6 + growth * 4, 10);
      } else {
        if (plot.stage === 'bloom' && !plot.wilted) {
          p.fill(232, 204, 160, 10); p.circle(0, 0, 55);
        }
        for (let petal = 0; petal < 7; petal++) {
          p.push(); p.rotate(petal * p.TWO_PI / 7 + (plot.wilted ? .3 : 0));
          p.fill(plot.wilted ? '#a798a8' : petal % 2 ? '#d1b9d8' : '#e0cce3');
          p.ellipse(0, -8 * opening, 8 * opening + 2, 18 * opening + 2); p.pop();
        }
        p.fill('#e8cca0'); p.circle(0, 0, 7);
        p.fill('#b39462'); p.circle(0, 0, 2);
      }
      p.pop();
    }

    function atmosphere(state, time) {
      const w = p.width, h = p.height;
      p.strokeWeight(1);
      const drops = reducedMotion.matches ? 0 : Math.floor(state.rainfall * .65);
      p.stroke(203, 219, 225, 55);
      for (let i = 0; i < drops; i++) {
        const x = ((i * 173 + time * 18) % 997) / 997 * w;
        const y = ((i * 79 + time * 170) % 601) / 601 * h;
        p.line(x, y, x - 3, y + 9);
      }
      p.noStroke();
      for (let i = 0; i < 16; i++) {
        const x = ((i * 67 + 37) % 997) / 997 * w + Math.sin(time * .25 + i) * 12;
        const y = h * (.43 + ((i * 17) % 43) / 100) + Math.cos(time * .32 + i) * 8;
        const alpha = 85 + Math.sin(time * 1.2 + i) * 65;
        p.fill(232, 204, 160, alpha * .12); p.circle(x, y, 13);
        p.fill(232, 204, 160, alpha); p.circle(x, y, 2);
      }
      if (state.complete) {
        if (completedAt === null) completedAt = p.millis();
        const age = (p.millis() - completedAt) / 1000;
        if (!reducedMotion.matches && age < 12) {
          for (let i = 0; i < 45; i++) {
            const x = ((i * 137 + Math.sin(time + i) * 15) % 997) / 997 * w;
            const y = h - ((age * 25 + i * 17) % (h + 30));
            p.fill(i % 2 ? '#e8cca090' : '#d1b9d890'); p.ellipse(x, y, 3, 5);
          }
        }
      } else completedAt = null;
    }

    p.draw = () => {
      const scene = window.gardenScene;
      if (!scene || !container.clientWidth || document.hidden) return;
      const { state } = scene;
      const round = `${state.code}-${state.round}`;
      if (round !== previousRound) { visibleGrowth.fill(0); previousRound = round; completedAt = null; }
      const time = reducedMotion.matches ? 0 : p.millis() / 1000;
      drawSky(state, time);
      for (const plot of state.plots) flower(plot, p.width * (.23 + plot.id % 3 * .27), p.height * (.61 + Math.floor(plot.id / 3) * .13), time);
      atmosphere(state, time);
    };
    const observer = new ResizeObserver(() => {
      if (p.canvas && container.clientWidth && container.clientHeight) p.resizeCanvas(container.clientWidth, container.clientHeight);
    });
    observer.observe(container);
    reducedMotion.addEventListener('change', () => p.frameRate(reducedMotion.matches ? 8 : 30));
  });
};
