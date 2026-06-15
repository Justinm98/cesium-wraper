import { CUSTOM_ELEMENTS_SCHEMA, Component } from '@angular/core';
import {
  CesiumGlobeComponent,
  SatelliteConfig,
  TerminalConfig,
} from '@enterprise/cesium-wrapper';

/**
 * One row in the mission satellite catalog. `tracked` drives whether the
 * satellite is currently fed to the globe.
 */
interface CatalogEntry {
  config: SatelliteConfig;
  tracked: boolean;
}

/**
 * The ISS TLE is real (historic epoch); the DEMO-* sets are synthetic
 * variations of it (different inclination/RAAN/mean motion) that produce
 * valid, visually distinct orbits without claiming to be real spacecraft.
 */
const CATALOG: CatalogEntry[] = [
  {
    tracked: true,
    config: {
      id: 'iss',
      label: 'ISS (ZARYA)',
      tle: {
        line1: '1 25544U 98067A   24001.50000000  .00016717  00000-0  10270-3 0  9000',
        line2: '2 25544  51.6400 208.9163 0006317  69.9862  25.2906 15.49560532    15',
      },
    },
  },
  {
    tracked: true,
    config: {
      id: 'demo-polar-1',
      label: 'DEMO POLAR-1',
      tle: {
        line1: '1 90001U 98067A   24001.50000000  .00016717  00000-0  10270-3 0  9000',
        line2: '2 90001  97.4000 100.0000 0006317  69.9862 200.0000 14.20000000    15',
      },
    },
  },
  {
    tracked: true,
    config: {
      id: 'demo-leo-2',
      label: 'DEMO LEO-2',
      tle: {
        line1: '1 90002U 98067A   24001.50000000  .00016717  00000-0  10270-3 0  9000',
        line2: '2 90002  53.0000 310.0000 0006317 150.0000  80.0000 15.05000000    15',
      },
    },
  },
  {
    tracked: false,
    config: {
      id: 'demo-geo-1',
      label: 'DEMO GEO-1',
      tle: {
        line1: '1 90003U 98067A   24001.50000000  .00016717  00000-0  10270-3 0  9000',
        line2: '2 90003   0.0500  75.0000 0006317   0.0000 180.0000  1.00270000    15',
      },
    },
  },
];

const INITIAL_TERMINALS: TerminalConfig[] = [
  {
    id: 'gs-dc',
    label: 'DC GATEWAY',
    position: { latitude: 38.9, longitude: -77.0, altitude: 100 },
  },
  {
    id: 'gs-hawaii',
    label: 'HAWAII RELAY',
    position: { latitude: 21.3, longitude: -157.9, altitude: 50 },
  },
];

@Component({
  selector: 'app-root',
  imports: [CesiumGlobeComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css',
  // Astro UXDS components are plain custom elements (rux-*); this schema
  // tells the Angular compiler not to reject their tags and attributes.
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
})
export class AppComponent {
  readonly catalog: CatalogEntry[] = CATALOG;

  /** Inputs to <cesium-globe>; replaced immutably so the differ sees changes. */
  satellites: SatelliteConfig[] = this.trackedSatellites();
  terminals: TerminalConfig[] = [...INITIAL_TERMINALS];
  timeConfig = { mode: 'realtime' as const, multiplier: 1 };

  /** Form state for the "add ground terminal" panel. */
  newTerminalName = '';
  newTerminalLat = '';
  newTerminalLon = '';
  terminalFormError = '';

  readonly speedOptions = [1, 10, 60, 600];
  initFailure = '';

  toggleTracked(entry: CatalogEntry): void {
    entry.tracked = !entry.tracked;
    this.satellites = this.trackedSatellites();
  }

  setSpeed(multiplier: number): void {
    this.timeConfig = { mode: 'realtime', multiplier };
  }

  addTerminal(): void {
    const latitude = Number(this.newTerminalLat);
    const longitude = Number(this.newTerminalLon);
    const name = this.newTerminalName.trim();
    if (name === '' || Number.isNaN(latitude) || Number.isNaN(longitude)) {
      this.terminalFormError = 'Name, latitude, and longitude are required.';
      return;
    }
    if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
      this.terminalFormError = 'Latitude must be in [-90, 90], longitude in [-180, 180].';
      return;
    }
    this.terminalFormError = '';
    this.terminals = [
      ...this.terminals,
      {
        id: `gs-${Date.now()}`,
        label: name.toUpperCase(),
        position: { latitude, longitude, altitude: 0 },
      },
    ];
    this.newTerminalName = '';
    this.newTerminalLat = '';
    this.newTerminalLon = '';
  }

  removeTerminal(id: string): void {
    this.terminals = this.terminals.filter((t) => t.id !== id);
  }

  onInitError(error: Error): void {
    this.initFailure = error.message;
  }

  readValue(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  private trackedSatellites(): SatelliteConfig[] {
    return this.catalog.filter((e) => e.tracked).map((e) => e.config);
  }
}
