import { bootstrapApplication } from '@angular/platform-browser';
import { provideHttpClient } from '@angular/common/http';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { providePrimeNG } from 'primeng/config';
import Aura from '@primeuix/themes/aura';
import { AppComponent } from './app.component';
bootstrapApplication(AppComponent, {providers:[provideHttpClient(),provideAnimationsAsync(),providePrimeNG({theme:{preset:Aura}})]}).catch(console.error);
