package dev.lgo.example;
import java.util.Map;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
@RestControllerAdvice public class ApiAdvice {
 @ExceptionHandler(TipoExameService.Missing.class) ResponseEntity<Map<String,String>> missing(TipoExameService.Missing error){return ResponseEntity.status(NotFoundPolicy.status()).body(Map.of("message",error.getMessage()));}
 @ExceptionHandler(TipoExameService.Duplicate.class) ResponseEntity<Map<String,String>> duplicate(){return ResponseEntity.status(409).body(Map.of("message","Código já cadastrado"));}
}
