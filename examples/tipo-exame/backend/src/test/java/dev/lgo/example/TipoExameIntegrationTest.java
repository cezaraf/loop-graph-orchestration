package dev.lgo.example;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;
@SpringBootTest @AutoConfigureMockMvc class TipoExameIntegrationTest {
 @Autowired MockMvc mvc;
 @Test void publishedOpenApiMatchesMissingResponse() throws Exception {
  var document=new com.fasterxml.jackson.databind.ObjectMapper().readTree(java.nio.file.Path.of("../contract/openapi.json").toFile());
  org.junit.jupiter.api.Assertions.assertTrue(document.path("paths").path("/api/tipos-exame/{codigo}").path("get").path("responses").has("404"));
  mvc.perform(get("/api/tipos-exame/contract-missing")).andExpect(status().isNotFound());
 }
 @Test void absentReturns404() throws Exception {mvc.perform(get("/api/tipos-exame/absent")).andExpect(status().isNotFound());}
 @Test void crudAndContract() throws Exception {
  mvc.perform(post("/api/tipos-exame").contentType(MediaType.APPLICATION_JSON).content("{\"codigo\":\"HEM\",\"nome\":\"Hemograma\"}")).andExpect(status().isCreated()).andExpect(jsonPath("$.codigo").value("HEM"));
  mvc.perform(get("/api/tipos-exame/HEM")).andExpect(status().isOk()).andExpect(jsonPath("$.nome").value("Hemograma"));
  mvc.perform(put("/api/tipos-exame/HEM").contentType(MediaType.APPLICATION_JSON).content("{\"codigo\":\"HEM\",\"nome\":\"Hemograma completo\"}")).andExpect(status().isOk()).andExpect(jsonPath("$.nome").value("Hemograma completo"));
  mvc.perform(get("/api/tipos-exame")).andExpect(status().isOk()).andExpect(jsonPath("$[0].codigo").value("HEM"));
  mvc.perform(delete("/api/tipos-exame/HEM")).andExpect(status().isNoContent());
  mvc.perform(get("/api/tipos-exame/HEM")).andExpect(status().isNotFound());
 }
 @Test void rejectsInvalidInput() throws Exception {mvc.perform(post("/api/tipos-exame").contentType(MediaType.APPLICATION_JSON).content("{\"codigo\":\"\",\"nome\":\"\"}")).andExpect(status().isBadRequest());}
 @Test void duplicateReturns409() throws Exception {
  String value="{\"codigo\":\"DUP\",\"nome\":\"Duplicado\"}";
  mvc.perform(post("/api/tipos-exame").contentType(MediaType.APPLICATION_JSON).content(value)).andExpect(status().isCreated());
  mvc.perform(post("/api/tipos-exame").contentType(MediaType.APPLICATION_JSON).content(value)).andExpect(status().isConflict());
 }
}
