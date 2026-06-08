#include <SoftwareSerial.h>
#include "modbus_crc.h"

SoftwareSerial RS485(2, 8); // RX, TX
int RS485_E = 7;
unsigned char  cmd[8] = {0x01,0x05,0,0,0,0,0,0}; 
unsigned int   crc;
unsigned char i,j;

void setup()  
{
  Serial.begin(9600);
  Serial.println("*** Modbus RTU Relay Test Program ***\r\n");

  RS485.begin(9600);
  pinMode(RS485_E,OUTPUT);
  digitalWrite(RS485_E,HIGH);   //send
}

void loop() // run over and over
{   
    for(i=0;i<8;i++){
      cmd[2] = 0;
      cmd[3] = i;
      cmd[4] = 0xFF;
      cmd[5] = 0;
      crc = ModbusCRC((unsigned char  *)cmd,6);
      cmd[6] = crc & 0xFF;
      cmd[7] = crc >> 8;
      for(j=0;j<8;j++){
        Serial.print(cmd[j],HEX);
        Serial.print(" ");
        RS485.write(cmd[j]);
      }
      Serial.println("");
      delay(200);
    }
    
    for(i=0;i<8;i++){
      cmd[2] = 0;
      cmd[3] = i;
      cmd[4] = 0;
      cmd[5] = 0;
      crc = ModbusCRC((unsigned char  *)cmd,6);
      cmd[6] = crc & 0xFF;
      cmd[7] = crc >> 8;
      for(j=0;j<8;j++){
        Serial.print(cmd[j],HEX);
        Serial.print(" ");
        RS485.write(cmd[j]);
      }
      Serial.println("");
      delay(200);
    }
}
