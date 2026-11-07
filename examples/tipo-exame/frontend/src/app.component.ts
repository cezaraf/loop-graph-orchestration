import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
interface TipoExame {codigo:string;nome:string}
@Component({selector:'app-root',standalone:true,imports:[CommonModule,FormsModule,TableModule,ButtonModule,InputTextModule],template:`
<h1>Tipos de exame</h1>
<p class="error" role="alert" *ngIf="error">{{error}}</p>
<form (ngSubmit)="save()" #form="ngForm">
 <label>Código <input pInputText name="codigo" [(ngModel)]="draft.codigo" required maxlength="30" [disabled]="editing"></label>
 <label>Nome <input pInputText name="nome" [(ngModel)]="draft.nome" required maxlength="120"></label>
 <p-button type="submit" label="Salvar" [disabled]="form.invalid || busy"/>
 <p-button type="button" label="Cancelar" (onClick)="reset()"/>
</form>
<p-table [value]="items"><ng-template #header><tr><th>Código</th><th>Nome</th><th>Ações</th></tr></ng-template>
<ng-template #body let-item><tr><td>{{item.codigo}}</td><td>{{item.nome}}</td><td><p-button label="Editar" (onClick)="edit(item)"/><p-button label="Excluir" severity="danger" (onClick)="remove(item)"/></td></tr></ng-template></p-table>`})
export class AppComponent implements OnInit {
 private http=inject(HttpClient);items:TipoExame[]=[];draft:TipoExame={codigo:'',nome:''};editing=false;busy=false;error='';
 ngOnInit(){this.load();}
 load(){this.http.get<TipoExame[]>('/api/tipos-exame').subscribe({next:items=>this.items=items,error:()=>this.error='Não foi possível carregar os exames.'});}
 edit(item:TipoExame){this.draft={...item};this.editing=true;}
 reset(){this.draft={codigo:'',nome:''};this.editing=false;this.error='';}
 save(){this.busy=true;const body={...this.draft};const request=this.editing?this.http.put('/api/tipos-exame/'+encodeURIComponent(body.codigo),body):this.http.post('/api/tipos-exame',body);request.subscribe({next:()=>{this.busy=false;this.reset();this.load();},error:()=>{this.busy=false;this.error='Falha ao salvar. Verifique os dados e o código.';}});}
 remove(item:TipoExame){if(!confirm('Excluir '+item.nome+'?'))return;this.http.delete('/api/tipos-exame/'+encodeURIComponent(item.codigo)).subscribe({next:()=>this.load(),error:()=>this.error='Falha ao excluir.'});}
}
