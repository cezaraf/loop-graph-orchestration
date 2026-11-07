package dev.lgo.example;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
@Entity public class TipoExame {
 @Id @NotBlank @Size(max=30) private String codigo;
 @NotBlank @Size(max=120) private String nome;
 protected TipoExame() {}
 public TipoExame(String codigo,String nome){this.codigo=codigo;this.nome=nome;}
 public String getCodigo(){return codigo;}
 public String getNome(){return nome;}
 public void setCodigo(String codigo){this.codigo=codigo;}
 public void setNome(String nome){this.nome=nome;}
}
